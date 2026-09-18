//! Live solve phase: lanes, fallbacks, pieces and assembly from live state.
//! No tails. `q-probe` verifies every lane against dumped `edge_q`;
//! `solve-live` verifies field, pieces and `SolveOut` against gate dumps.
//!
//! Sequencing (proven by probe): tails/lanes read the PRE-dance field, the
//! solve updates it. The engine evaluates closures at solve time with the
//! solve-time field, exactly like the solve it replaces.
//!
//! Boundaries (pre-evaluated by callers): `exh_open` (relief exhaust state;
//! the events stage ports it), scrammed `tprog` (runback needs the frozen
//! cabinet; corpus plants never scram — a scrammed tick yields NaN lanes,
//! loud by construction). `q39/q40` stay NaN: no Ck<0 edge consumes them.
use std::collections::HashMap;

use crate::{edge, eos, field, live, netlive, sec, step};

/// Commission-frozen edge tables for the live lanes (`FREEZE.build()`).
pub struct EdgeFrozen {
    pub steam_ref: f64,
    pub casing_f: f64,
    pub pump_h0: f64,
    pub head_k: f64,
    pub tank_rho: f64,
    pub turb_c: f64,
    pub swallow: f64,
    pub bypass: f64,
    pub rho0: f64,
    pub rated: f64,
    pub pump_head: HashMap<String, f64>,
    pub pump_rho0: HashMap<String, f64>,
    pub pump_suc: HashMap<String, String>,
    pub sec_circ: HashMap<String, i64>,
    pub pool_part_h: HashMap<String, f64>,
    pub vent_circ: HashMap<String, i64>,
    pub vent_vac: HashMap<String, bool>,
    pub cond_sink_n: f64,
    pub cond_sink_ids: Vec<String>,
    pub cond_p_des: f64,
    pub sg_byp_band: f64,
    pub ptref: f64,
    /// Lane-time setpoints per circuit (the dumped `set_p` is stale on
    /// phase-affected circuits; the march reads these settled).
    pub suggest: HashMap<i32, f64>,
    pub fit_ids: Vec<String>,
    pub fit_relief: Vec<bool>,
    pub sig_tanks: Vec<String>,
    pub edges: Vec<FrozenEdge>,
}

/// One frozen edge row: the lane writer's id inputs.
#[derive(Default)]
pub struct FrozenEdge {
    pub ck: i32,
    pub cdead: Option<String>,
    pub tid: Option<String>,
    pub end: Option<String>,
    pub freg: Option<String>,
    pub pid: Option<String>,
    pub cx: Option<i64>,
    pub cy: Option<i64>,
    pub pump: Option<String>,
    pub pool_at: Option<i64>,
    pub gate_mode: Option<String>,
    pub gate_ids: Vec<String>,
    pub hsrc_fn: bool,
    pub inert: Option<f64>,
    pub machine: Option<String>,
}

/// Sec curves with lane-time setpoints spliced in. Replay paths keep the
/// dumped curves untouched; the engine reads these settled values.
/// The dumped `set_p` only covers core circuits — extend for the rest.
pub fn patch_curves(c: &sec::SecCurves, suggest: &HashMap<i32, f64>) -> sec::SecCurves {
    let mut out = c.clone();
    for (k, v) in suggest {
        if *k >= 0 {
            while out.set_p.len() <= *k as usize {
                out.set_p.push(0.0);
            }
            out.set_p[*k as usize] = *v;
        }
    }
    out
}

/// Full 45-lane live derivation per edge, mirroring the gate writer order.
/// `st` is the POST-ctl state (demands applied, motors lagged): positions,
/// tank/relief answers and load all read live. Bags/levels/pressures are
/// ctl-untouched, so pre and post agree on them.
#[allow(clippy::too_many_arguments)]
pub fn lanes_live(
    meta: &step::StepMeta,
    curves: &sec::SecCurves,
    fr: &EdgeFrozen,
    st: &step::StepState,
    warr: &[f64],
    exh_open: bool,
    store_held: bool,
) -> (Vec<Vec<f64>>, Vec<Vec<f64>>) {
    let fz = &meta.solve;
    let sec = &st.sec;
    let ev = &st.events;
    let ref_open = sec.u8s.get("refOpen").copied().unwrap_or(false);
    let nb = meta.sec.boiler_ids.len().max(1) as f64;
    let post_load = st.sec.f64s.get("load").copied().unwrap_or(1.0);
    let hosted: Vec<String> = meta.sec.tank_ids.iter().enumerate()
        .filter(|(i, _)| meta.sec.tanks.get(*i).map(|r| !r.cell).unwrap_or(false))
        .map(|(_, id)| id.clone()).collect();
    let mut hv = 0.0f64;
    for (i, _) in meta.sec.tank_ids.iter().enumerate() {
        if meta.sec.tanks.get(i).map(|r| !r.cell).unwrap_or(false) {
            hv += meta.sec.tanks.get(i).map(|r| r.vol).unwrap_or(0.0);
        }
    }
    let mut out_q: Vec<Vec<f64>> = Vec::with_capacity(fz.ne);
    let mut out_g: Vec<Vec<f64>> = Vec::with_capacity(fz.ne);
    for e in 0..fz.ne {
        let er = &fr.edges[e];
        let ck = fz.ck[e];
        let mut q = vec![f64::NAN; 45];
        if ck >= 0 {
            q[1] = match &er.cdead {
                Some(id) => if netlive::part_wrecked(&sec.dmg_parts, id) { 1.0 } else { 0.0 },
                None => f64::NAN,
            };
        }
        let has_w = fz.wi[e] >= 0;
        q[3] = if has_w { 1.0 } else { 0.0 };
        q[2] = if has_w { warr[fz.wi[e] as usize] } else { f64::NAN };
        if ck == 1 {
            q[4] = match &er.tid {
                Some(tid) => if live::tank_open_live(meta, curves, st, tid) { 1.0 } else { 0.0 },
                None => f64::NAN,
            };
        }
        if ck == 1 || ck == 2 {
            q[5] = match &er.end {
                Some(end) => if netlive::port_live(&ev.port_shut, &sec.dmg_parts, end) { 1.0 } else { 0.0 },
                None => f64::NAN,
            };
        }
        if ck == 4 {
            q[6] = st.sec.maps.get("fregBy").and_then(|m| m.get(er.freg.as_deref().unwrap_or(""))).unwrap_or(f64::NAN);
            q[7] = edge::duty_c(fr.steam_ref / nb, edge::SAT_RHO, fr.casing_f, fr.pump_h0);
        }
        if ck == 5 {
            match &er.pid {
                Some(pid) => {
                    let bits = fr.sec_circ.get(pid).copied().unwrap_or(0);
                    let piped = (bits & 1) != 0 && (bits & 2) != 0;
                    let work = edge::turb_work_of(piped, post_load, fr.swallow, fr.steam_ref, ev.turb_trip);
                    q[8] = edge::turb_c_of(
                        netlive::part_wrecked(&sec.dmg_parts, pid),
                        fr.turb_c, work,
                        dump_live(meta, curves, fr, st, post_load, exh_open),
                    );
                }
                None => q[8] = f64::NAN,
            }
        }
        if ck == 6 {
            match &er.pid {
                Some(pid) => {
                    q[9] = if netlive::part_wrecked(&sec.dmg_parts, pid) { 1.0 } else { 0.0 };
                    let nsg = meta.sec.sg_design_p.len().max(1) as f64;
                    let des = meta.sec.sg_design_p.iter().sum::<f64>() / nsg;
                    let wast = sec.maps.get("sgWastBy").and_then(|m| m.get(pid)).unwrap_or(1.0);
                    q[10] = edge::sgtr_c(meta.sec.loop_kg, fr.rho0, curves.set_p(meta.sec.core_circ), des) * wast;
                }
                None => {
                    q[9] = f64::NAN;
                    q[10] = f64::NAN;
                }
            }
        }
        if ck == 7 {
            q[11] = match (er.cx, er.cy) {
                (Some(x), Some(y)) => if netlive::cell_broken(&sec.dmg_parts, x as i32, y as i32) { 1.0 } else { 0.0 },
                _ => f64::NAN,
            };
        }
        if ck == 8 || ck == 10 || ck == 12 || ck == 15 {
            q[12] = match &er.pid {
                Some(pid) => if netlive::part_wrecked(&sec.dmg_parts, &format!("port:{pid}")) { 1.0 } else { 0.0 },
                None => f64::NAN,
            };
        }
        if ck == 9 {
            q[14] = match &er.pid {
                Some(pid) => if netlive::sg_open(&sec.dmg_parts, &ev.sg_burst, pid) { 1.0 } else { 0.0 },
                None => f64::NAN,
            };
        }
        if ck == 10 {
            match &er.pid {
                Some(pid) => {
                    let vac = fr.vent_vac.get(pid).copied().unwrap_or(false);
                    let vent = ev.cond_lost && vac;
                    q[15] = if vent { 1.0 } else { 0.0 };
                    q[16] = if vent {
                        match fr.vent_circ.get(pid).copied() {
                            Some(ci) => {
                                let c = curves.of(ci as i32);
                                edge::cond_vent_bore(fr.steam_ref, fr.cond_sink_n as usize, crate::eos::rhog_of(c, crate::eos::sat_t(c, edge::COND_ATM)))
                            }
                            None => f64::NAN,
                        }
                    } else {
                        f64::NAN
                    };
                    q[17] = if netlive::cond_dump_open(&sec.tank_dump, &hosted) { 1.0 } else { 0.0 };
                    q[18] = edge::cond_dump_kgs(hv / fr.cond_sink_n.max(1.0), fr.tank_rho);
                    q[19] = fr.tank_rho;
                }
                None => {
                    for l in [15, 16, 17, 18, 19] {
                        q[l] = f64::NAN;
                    }
                }
            }
        }
        if ck == 11 || ck == 14 {
            q[20] = if er.pid.as_deref().and_then(|p| st.core.get(p)).map(|cs| cs.breach).unwrap_or(false) { 1.0 } else { 0.0 };
        }
        if ck == 13 || ck == 14 {
            let cs = er.pid.as_deref().and_then(|p| st.core.get(p));
            q[21] = cs.map(|c| c.tubes_open).unwrap_or(f64::NAN);
            q[22] = if cs.map(|c| c.cav_relief).unwrap_or(false) { 1.0 } else { 0.0 };
        }
        if ck == 15 {
            match &er.pid {
                Some(pid) => {
                    q[23] = if sec.bmaps.get("burstBy").map(|m| m.get(pid)).unwrap_or(false) { 1.0 } else { 0.0 };
                    match meta.sec.tank_ids.iter().position(|x| x == pid) {
                        Some(ti) => {
                            let row = &meta.sec.tanks[ti];
                            q[24] = meta.sec.tank_kg.get(ti).copied().unwrap_or(f64::NAN);
                            q[25] = row.vol;
                            q[26] = row.burst.as_ref().map(|b| b.drain).unwrap_or(f64::NAN);
                            q[27] = row.burst.as_ref().map(|b| b.at).unwrap_or(f64::NAN);
                            q[28] = if row.burst.is_some() { 1.0 } else { 0.0 };
                        }
                        None => {
                            for l in [24, 25, 26, 27, 28] {
                                q[l] = f64::NAN;
                            }
                        }
                    }
                    q[29] = meta.sec.pcont;
                }
                None => {
                    for l in [23, 24, 25, 26, 27, 28, 29] {
                        q[l] = f64::NAN;
                    }
                }
            }
        }
        q[30] = fr.casing_f;
        q[31] = fr.pump_h0;
        q[32] = if er.pump.is_some() { 1.0 } else { 0.0 };
        if let Some(pid) = &er.pump {
            q[33] = fr.pump_head.get(pid).copied().unwrap_or(f64::NAN);
            q[34] = edge::pump_drive(
                netlive::part_wrecked(&sec.dmg_parts, pid),
                sec.maps.get("flowBy").and_then(|m| m.get(pid)),
            );
            q[35] = edge::cav_of(sec.maps.get("cavP").and_then(|m| m.get(pid)));
            q[36] = match (fr.pump_rho0.get(pid).copied(), fr.pump_suc.get(pid)) {
                (Some(r0), Some(suc)) => edge::pump_rho_k(store_held, r0, live::net_rho_at(meta, curves, st, suc)),
                _ => f64::NAN,
            };
        }
        q[37] = if fz.pool_at[e] >= 0 {
            live::pool_h(meta, curves, st, fz.pool_at[e] as usize, fr.pool_part_h.get(&fz.pool_at[e].to_string()).copied())
        } else {
            0.0
        };
        q[38] = fr.head_k;
        // q39 stays NaN: no Ck<0 edge consumes the h0 lane (loud on appearance).
        // q40 replays the hSrc closure off the same lane values it reads.
        q[40] = if er.hsrc_fn {
            edge::pump_head_now(q[33], q[34], q[35], q[36]) * fr.head_k
        } else {
            0.0
        };
        q[41] = er.inert.unwrap_or(f64::NAN);
        let mut gv = vec![];
        if ck == 3 {
            q[43] = if er.gate_mode.as_deref() == Some("throttle") { 1.0 } else { 0.0 };
            q[44] = match &er.pid {
                Some(pid) => if netlive::relief_live(ref_open, &ev.relief_open, &ev.relief_blocked, pid) { 1.0 } else { 0.0 },
                None => f64::NAN,
            };
        }
        // Throttle gates ride any Ck (drum-fence Ck4 keeps its gate ids).
        if er.gate_mode.as_deref() == Some("throttle") {
            for fid in &er.gate_ids {
                gv.push(st.sec.maps.get("valve").and_then(|m| m.get(fid)).unwrap_or(f64::NAN));
            }
        }
        out_q.push(q);
        out_g.push(gv);
    }
    (out_q, out_g)
}

/// Bypass/dump opening off live leaves (`dumpOf`); `tprog` takes the load
/// branch (scrammed ticks yield NaN — runback needs the frozen cabinet).
/// Public for the work-share reader (same inputs as lane q8).
pub fn dump_live(
    meta: &step::StepMeta,
    curves: &sec::SecCurves,
    fr: &EdgeFrozen,
    st: &step::StepState,
    load: f64,
    exh_open: bool,
) -> f64 {
    let region = if exh_open {
        match meta.sec.parts.iter().find(|p| p.role == "cond").and_then(|p| meta.sec.part_of.get(&p.id).copied()) {
            Some(pi) => live::live_region_p_at(meta, st, Some(pi)),
            None => f64::NAN,
        }
    } else {
        0.0
    };
    let lost = if st.events.cond_lost { edge::COND_ATM } else { 0.0 };
    let read = live::cond_p_read(meta, curves, st, &fr.cond_sink_ids, fr.cond_p_des);
    let cond_p = eos::js_max(region, eos::js_max(lost, read));
    let avail = cond_p < 0.02 * 0.75;
    let tavg = st.sec.f64s.get("Tavg").copied().unwrap_or(f64::NAN);
    let tprog = if st.events.scrammed {
        f64::NAN
    } else {
        fr.ptref - 18.0 + 18.0 * live::unit_frac(meta, st, fr.rated, load)
    };
    let over = live::sg_over_frac(meta, curves, st);
    let dump_p = eos::clamp(over / fr.sg_byp_band, 0.0, 1.0) * fr.bypass;
    let rule_any = netlive::tank_rule_any(
        &meta.sec.tank_ids,
        |id| meta.sec.tank_ids.iter().position(|x| x == id).and_then(|i| meta.sec.tanks.get(i)).map(|r| r.auto.clone()).unwrap_or("manual".to_string()),
        |id| meta.sec.tank_ids.iter().position(|x| x == id).and_then(|i| meta.sec.tanks.get(i)).map(|r| netlive::tank_secondary(r.circuit, &meta.sec.core_circs)).unwrap_or(false),
        |id| st.sec.tank_byp.get(id).copied().unwrap_or(false),
    );
    edge::dump_of(avail, tavg, tprog, fr.bypass, dump_p, st.events.scrammed, rule_any)
}

/// Fallback (p, h) per node plus pool levels per condenser vessel.
pub fn fallbacks_live(
    meta: &step::StepMeta,
    curves: &sec::SecCurves,
    st: &step::StepState,
) -> (Vec<f64>, Vec<f64>, Vec<Option<f64>>) {
    let n = meta.solve.n;
    let mut fp = Vec::with_capacity(n);
    let mut fh = Vec::with_capacity(n);
    for i in 0..n {
        let nm = meta.sec.net_names.get(i).map(|s| s.as_str()).unwrap_or("");
        fp.push(live::sec_net_p_at(meta, curves, st, nm));
        fh.push(live::sec_net_h_at(meta, curves, st, nm));
    }
    let pool = meta.solve.cond_v.iter()
        .map(|&cv| live::pool_lvl_of(meta, curves, st, cv as usize))
        .collect();
    (fp, fh, pool)
}

/// Live piece cache: signature over the solve-time field, BFS over live `g`.
/// `shut` arrives in live insertion order (the engine keeps an ordered set;
/// dumps sort it — empty across every gate run to date). Returns cache hit.
#[allow(clippy::too_many_arguments)]
pub fn pieces_live(
    meta: &step::StepMeta,
    fr: &EdgeFrozen,
    curves: &sec::SecCurves,
    fs: &field::FieldState,
    st: &step::StepState,
    q: &[Vec<f64>],
    gv: &[Vec<f64>],
    warr: &[f64],
    shut: &[String],
    memo: &mut netlive::PiecesMemo,
) -> (bool, String) {
    let fz = &meta.solve;
    let tank_bits: Vec<bool> = fr.sig_tanks.iter()
        .map(|tid| live::tank_open_live(meta, curves, st, tid))
        .collect();
    let mut fits = Vec::with_capacity(fr.fit_ids.len());
    for (fi, fid) in fr.fit_ids.iter().enumerate() {
        if fr.fit_relief.get(fi).copied().unwrap_or(false) {
            fits.push(netlive::FitSig::Relief(netlive::relief_live(
                st.sec.u8s.get("refOpen").copied().unwrap_or(false),
                &st.events.relief_open, &st.events.relief_blocked, fid)));
        } else {
            fits.push(netlive::FitSig::Throttle {
                map_present: st.sec.maps.contains_key("valve"),
                v: st.sec.maps.get("valve").and_then(|m| m.get(fid)),
            });
        }
    }
    let mut cores = Vec::with_capacity(meta.core_ids.len());
    for id in &meta.core_ids {
        match st.core.get(id) {
            Some(cs) => cores.push(netlive::CoreFlags { breach: cs.breach, tubes_open: cs.tubes_open, cav_relief: cs.cav_relief }),
            None => cores.push(netlive::CoreFlags { breach: false, tubes_open: 0.0, cav_relief: false }),
        }
    }
    let mut g = vec![0.0; fz.ne];
    let mut diodes = vec![];
    for e in 0..fz.ne {
        let d = fz.diode_s[e];
        if d != 0.0 && !d.is_nan() {
            let (_, h, _) = step::edge_gh_lanes(fz, fs, warr, &q[e], &gv[e], e, false);
            diodes.push(netlive::DiodeEdge { u: fz.eu[e] as usize, v: fz.ev[e] as usize, diode: d, h });
        }
        g[e] = step::edge_gh_lanes(fz, fs, warr, &q[e], &gv[e], e, false).0;
    }
    let load = st.sec.f64s.get("load").copied().unwrap_or(1.0);
    let inp = netlive::LiveSigIn {
        tank_bits: &tank_bits,
        fits: &fits,
        dmg: &st.sec.dmg_parts,
        shut,
        cores: &cores,
        dry: netlive::net_dry_sig(&fs.wet),
        diode: netlive::net_diode_sig(&fs.p, &diodes),
        turb_trip: st.events.turb_trip,
        cond_lost: st.events.cond_lost,
        load_pos: load > 0.0,
    };
    let sig = netlive::net_live_sig_build(&inp);
    (memo.update(&sig, fz.n, &fz.eu, &fz.ev, &g), sig)
}

/// `netPieces` reader equivalent: recompute lanes off current state, then
/// the cached BFS. Every live reader that needs pieces calls this (hold,
/// stage, tank, core, loop); the solve itself never touches the cache —
/// it reads the memo as-is, exactly like `netSolve`.
/// Returns the current live signature (div/reuse diagnostics).
#[allow(clippy::too_many_arguments)]
pub fn pieces_read(
    meta: &step::StepMeta,
    fr: &EdgeFrozen,
    curves: &sec::SecCurves,
    fs: &field::FieldState,
    st: &step::StepState,
    warr: &[f64],
    exh_open: bool,
    store_held: bool,
    shut: &[String],
    memo: &mut netlive::PiecesMemo,
) -> String {
    let (q, gv) = lanes_live(meta, curves, fr, st, warr, exh_open, store_held);
    pieces_live(meta, fr, curves, fs, st, &q, &gv, warr, shut, memo).1
}

/// `netNatCirc` constants (pipenet.js:2893).
pub const NAT_PASSES: usize = 8;
pub const NAT_TOL: f64 = 1e-3;
pub const NAT_EVERY: u64 = 25;

/// The thermosiphon answer held between recomputes (`net.natTick/natPBy/
/// natLoop`). Seeded from the commission sidecar.
#[derive(Default)]
pub struct NatCarry {
    pub tick: u64,
    pub p_v: Vec<f64>,
    pub p_has: Vec<u8>,
    pub loop_kg: Vec<f64>,
}

/// `flowScale = 0`: every pump's drive lane reads zero, which is the whole
/// of what standing the pumps down means to the solve.
fn pumps_off(fr: &EdgeFrozen, q: &mut [Vec<f64>]) {
    for (e, row) in q.iter_mut().enumerate() {
        if fr.edges.get(e).map(|r| r.pump.is_some()).unwrap_or(false) {
            row[34] = 0.0;
        }
    }
}

/// One `netNatCirc` recompute: up to `NAT_PASSES` solves with the pumps down
/// and the store held, each on the last one's pressure field, stopping when
/// the core total settles. Leaves `carried` polluted exactly as the JS does
/// (`w` restored by the caller, the field re-updated after).
#[allow(clippy::too_many_arguments)]
pub fn nat_passes(
    meta: &step::StepMeta,
    fr: &EdgeFrozen,
    curves: &sec::SecCurves,
    st: &step::StepState,
    carried: &mut step::SolveCarried,
    nat: &mut NatCarry,
    tail: &step::SolveTail,
    warns: &mut u32,
    memo: &mut netlive::PiecesMemo,
) -> Vec<f64> {
    let fz = &meta.solve;
    let (fb_p, fb_h, pool) = fallbacks_live(meta, curves, st);
    let level = st.sec.f64s.get("P").copied().unwrap_or(meta.sec.p0);
    let (mut pb_v, mut pb_has) = if nat.p_v.len() == fz.n {
        (nat.p_v.clone(), nat.p_has.clone())
    } else {
        (st.p_by.v.clone(), st.p_by.has.clone())
    };
    let mut loop_kg = vec![0.0; fz.n_loops];
    let mut prev: Option<f64> = None;
    for _ in 0..NAT_PASSES {
        let (mut q, gv) = lanes_live(meta, curves, fr, st, &carried.warr, false, true);
        pumps_off(fr, &mut q);
        pieces_live(meta, fr, curves, &carried.fs, st, &q, &gv, &carried.warr, &[], memo);
        let inp = step::SolveIn {
            edge_q: &q,
            edge_gates: &gv,
            fallback_p: &fb_p,
            fallback_h: &fb_h,
            pool_lvl: &pool,
            pc_of: &memo.of,
            pc_npc: memo.n,
            pc_live: &memo.live,
            tail,
        };
        let out = step::solve_tick(
            fz, &fz.curves, carried, &pb_v, &pb_has, &st.m_by.v, &st.m_by.has,
            &st.h_by.v, &st.h_by.has, level, &inp, warns,
        );
        pb_v = out.p_field_v.clone();
        pb_has = out.p_field_has.clone();
        loop_kg = vec![0.0; fz.n_loops];
        for (li, v) in &out.by_loop_leg {
            if let Some(slot) = loop_kg.get_mut(*li as usize) {
                *slot += v;
            }
        }
        let ans = out.core_tot;
        if let Some(p) = prev {
            if (ans - p).abs() <= NAT_TOL * eos::js_max(ans.abs(), 1e-9) {
                break;
            }
        }
        prev = Some(ans);
    }
    nat.p_v = pb_v;
    nat.p_has = pb_has;
    nat.loop_kg = loop_kg.clone();
    loop_kg
}

/// Full live solve of one tick: lanes, fallbacks, field, pieces, assembly.
/// `st` is the POST-ctl state (pass applied, motors lagged). `tail` carries
/// the store/pin readers until their stages port; `shut` is the live-ordered
/// shut-port set; `memo` carries the piece cache.
#[allow(clippy::too_many_arguments)]
pub fn solve_live(
    meta: &step::StepMeta,
    fr: &EdgeFrozen,
    st: &step::StepState,
    carried: &mut step::SolveCarried,
    exh_open: bool,
    store_held: bool,
    tail: &step::SolveTail,
    warns: &mut u32,
    memo: &mut netlive::PiecesMemo,
    shut: &[String],
) -> (step::SolveOut, String, bool) {
    let curves = patch_curves(&meta.sec_curves, &fr.suggest);
    let (fb_p, fb_h, pool) = fallbacks_live(meta, &curves, st);
    let (q, gv) = lanes_live(meta, &curves, fr, st, &carried.warr, exh_open, store_held);
    let tb = step::solve_tables(&meta.solve);
    step::solve_field(
        &tb, &meta.solve, &meta.solve.curves, carried,
        &st.p_by.v, &st.p_by.has, &st.m_by.v, &st.m_by.has, &st.h_by.v, &st.h_by.has,
        &fb_p, &fb_h, &pool,
    );
    let (reuse, sig) = pieces_live(meta, fr, &curves, &carried.fs, st, &q, &gv, &carried.warr, shut, memo);
    let level = st.sec.f64s.get("P").copied().unwrap_or(meta.sec.p0);
    let inp = step::SolveIn {
        edge_q: &q,
        edge_gates: &gv,
        fallback_p: &fb_p,
        fallback_h: &fb_h,
        pool_lvl: &pool,
        pc_of: &memo.of,
        pc_npc: memo.n,
        pc_live: &memo.live,
        tail,
    };
    let out = step::solve_tick(
        &meta.solve, &meta.solve.curves, carried,
        &st.p_by.v, &st.p_by.has, &st.m_by.v, &st.m_by.has, &st.h_by.v, &st.h_by.has,
        level, &inp, warns,
    );
    (out, sig, reuse)
}
