//! Full `stepMarch(dt)` driver (§6.7): all gated stages in tick order on one
//! `StepState`, with explicit sync at every handoff.
//!
//! Design (see handover §6.6/§6.7 notes):
//! - Stage structs are owned per stage (`SecState`, `RoomState`, `EventsState`,
//!   per-vessel `CoreState`); the driver syncs shared leaves at handoffs.
//!   Copies are bitwise-exact; a missed leaf shows in the step gate.
//! - Node bags (`mBy/hBy/pBy/bBy/h2By/metalT`) are canonical in the driver;
//!   stages borrow or receive synced copies.
//! - `massOut` is canonical in the driver (insertion order preserved across
//!   stages that `book`); `dmgParts`/`ev`/aggregates likewise flow explicitly.
//! - Dice: only `burstDice` draws (`S.rng`), inside the sec stage — no
//!   cross-stage threading needed (`diceOff=true` in gates: zero draws).
//! - `laySettle`/`layRelease` are no-ops (zero S/P touches; layout frozen).
//! - Per-tick dumped tail (gate-evaluated JS readers the replay cannot
//!   compute): ctl `Sample`, solve edge predicates/pins/rows, sec masks,
//!   transport `advectSrc`/books, core `h_in`/`sink`/fallbacks, room
//!   `spillBy`/`reliefVent`/bores, events `rps`/`sink`/`dry`/`skin`-adjacents,
//!   `trip_near` mid-tail. Everything else flows through replay.

use std::collections::HashMap;

use crate::{
    core, ctl, edge, eos, events, field, hydro, live, net, pieces, read, room, sec, store, tick,
    transport,
};

/// Solve scratch carried across ticks (driver-owned).
#[derive(Clone)]
pub struct SolveCarried {
    pub fs: field::FieldState,
    pub memo: store::StoreState,
    pub warr: Vec<f64>,
    pub fix_v: Vec<f64>,
    pub pc_of: Vec<i32>,
    pub pc_npc: usize,
    pub pc_live: Vec<u8>,
    pub choke: bool,
    pub div_sig: Option<String>,
}

impl Default for SolveCarried {
    fn default() -> Self {
        SolveCarried {
            fs: field::FieldState {
                p: vec![], rho: vec![], x: vec![], b: vec![], rho_d: vec![],
                rho_g: vec![], rho_l: vec![], wet: vec![], void_: vec![],
                mu: vec![], lp: vec![], lh: vec![], lm: vec![],
            },
            memo: store::StoreState {
                kp: vec![], kh: vec![], km: vec![], p0: vec![], cc: vec![],
            },
            warr: vec![],
            fix_v: vec![],
            pc_of: vec![],
            pc_npc: 0,
            pc_live: vec![],
            choke: false,
            div_sig: None,
        }
    }
}

/// Per-preset derived solve tables (built once from `SolveFrozen`).
pub struct SolveTables {
    pub run_pos: Vec<i32>,
    pub tank_pos: Vec<i32>,
    pub shell_pos: Vec<i32>,
    pub sgtr_pos: Vec<i32>,
    pub relief_pos: Vec<i32>,
    pub by_pos: Vec<i32>,
    pub core_pos: Vec<i32>,
    pub loop_stab: Vec<i32>,
    pub tank_nodes: Vec<u8>,
    pub in_core: Vec<bool>,
    pub run_order: Vec<i32>,
    pub field_struct: field::FieldStruct,
}

fn pos_of(t: &[i32]) -> Vec<i32> {
    let m = t.iter().max().unwrap_or(&-1);
    let mut p = vec![-1i32; (*m).max(-1) as usize + 1];
    for (k, &key) in t.iter().enumerate() {
        if key >= 0 {
            if key as usize >= p.len() {
                p.resize(key as usize + 1, -1);
            }
            p[key as usize] = k as i32;
        }
    }
    p
}

fn bf(v: &[f64], i: usize) -> bool {
    edge::lane_flag(v, i)
}

fn opt_idx(v: i32) -> Option<usize> {
    if v < 0 { None } else { Some(v as usize) }
}

/// Shared dumped-lane → closure-input builder (solve assembly + sig-probe
/// diode heads): `CvalIn`, `HeadIn` and the carried flow.
pub fn edge_inputs<'a>(
    fz: &SolveFrozen,
    fs: &field::FieldState,
    warr: &[f64],
    q: &'a [f64],
    gv: &'a [f64],
    e: usize,
) -> (edge::CvalIn<'a>, edge::HeadIn, f64) {
    let wopt = if edge::lane_flag(q, 3) { Some(q[2]) } else { None };
    let mu = fs.mu[if wopt.map(|w| w >= 0.0).unwrap_or(false) {
        fz.eu[e] as usize
    } else {
        fz.ev[e] as usize
    }];
    let kin = edge::CvalIn {
        ck: fz.ck[e] as i8,
        c_closure: q[0],
        cdead_wrecked: edge::lane_flag(q, 1),
        bore: fz.bore[e],
        llen: fz.llen[e],
        k0: fz.k0[e],
        w: wopt,
        mu,
        tank_live: edge::lane_flag(q, 4),
        port_live: edge::lane_flag(q, 5),
        gate_valves: gv,
        gate_throttle: edge::lane_flag(q, 43),
        relief_live: edge::lane_flag(q, 44),
        freg: q[6],
        feed_train_c: q[7],
        turb_c: q[8],
        sgtr_live: edge::lane_flag(q, 9),
        sgtr_prod: q[10],
        broken: edge::lane_flag(q, 11),
        wrecked: edge::lane_flag(q, 12),
        hole_c: fz.hce[e],
        sg_open: edge::lane_flag(q, 14),
        vent_active: edge::lane_flag(q, 15),
        vent_bore: q[16],
        dump_open: edge::lane_flag(q, 17),
        dump_q: q[18],
        dump_rho: q[19],
        breach: edge::lane_flag(q, 20),
        tubes_open: q[21],
        cav_n: fz.cav_n[e],
        cav_one: fz.cav_one[e],
        cav_relief_flag: edge::lane_flag(q, 22),
        cav_relief: fz.cav_relief[e],
        burst_by: edge::lane_flag(q, 23),
        disc: edge::DiscIn {
            kg: q[24],
            vol: q[25],
            drain: q[26],
            at: q[27],
            has_burst: edge::lane_flag(q, 28),
            pcont: q[29],
        },
        casing_f: q[30],
        pump_h0: q[31],
        cc: fz.cc0[e],
    };
    let ph = edge::pump_head_now(q[33], q[34], q[35], q[36]);
    let rho_end = |i: usize| {
        if fz.gas_at[e] == i as i32 && (fs.x[i] > 0.0 || fs.void_[i] != 0) {
            fs.rho_g[i]
        } else if fz.liq_at[e] == i as i32 && fs.x[i] > 0.0 {
            fs.rho_l[i]
        } else {
            fs.rho[i]
        }
    };
    let sth = edge::static_h(
        fz.dz[e],
        rho_end(fz.eu[e] as usize),
        rho_end(fz.ev[e] as usize),
        if fz.pool_at[e] < 0 {
            0.0
        } else {
            (if fz.pool_at[e] as u32 == fz.eu[e] { 1.0 } else { -1.0 }) * q[37]
        },
    );
    let wraw = if fz.wi[e] < 0 { 0.0 } else { warr[fz.wi[e] as usize] };
    let hin = edge::HeadIn {
        ck_undef: fz.ck[e] < 0,
        is_pump: edge::lane_flag(q, 32),
        pump_head: ph,
        static_h: sth,
        head_k: q[38],
        h0: q[39],
        hsrc_closure: q[40],
        edge_in: edge::edge_in(true, if q[41].is_nan() { 0.0 } else { q[41] }),
    };
    (kin, hin, wraw)
}

/// Full per-edge `(g, h, choke)` from dumped lanes (sig-probe diode heads):
/// the solve's own edge branch with the field it solved against.
pub fn edge_gh_lanes(
    fz: &SolveFrozen,
    fs: &field::FieldState,
    warr: &[f64],
    q: &[f64],
    gv: &[f64],
    e: usize,
    choke_in: bool,
) -> (f64, f64, bool) {
    let (kin, hin, wraw) = edge_inputs(fz, fs, warr, q, gv, e);
    let cc = edge::edge_cval(&kin);
    let field = hydro::FlowField {
        p: &fs.p,
        x: Some(&fs.x),
        wet: Some(&fs.wet),
        void_: Some(&fs.void_),
        rho_d: &fs.rho_d,
        rho_g: &fs.rho_g,
        rho_l: &fs.rho_l,
    };
    let (g, h, ch) = if fz.g_is_fn[e] != 0 && cc > 0.0 {
        edge::edge_gh(
            cc, &hin, &field, fz.eu[e] as usize, fz.ev[e] as usize, fz.diode_s[e],
            opt_idx(fz.choke_at[e]), opt_idx(fz.gas_at[e]), opt_idx(fz.liq_at[e]), wraw,
        )
    } else if fz.g_is_fn[e] != 0 {
        (0.0, edge::edge_h(&hin, wraw), choke_in)
    } else {
        let gg = if fz.g_scalar[e] != 0.0 && !fz.g_scalar[e].is_nan() {
            fz.g_scalar[e]
        } else {
            0.0
        };
        (gg, 0.0, choke_in)
    };
    (g, edge::head_gate(fz.h_is_fn[e] != 0, h, fz.h_scalar[e]), ch)
}

/// Per-preset solve tables (mirrors solvefull-probe.rs:262-322 rebuilds).
pub fn solve_tables(fz: &SolveFrozen) -> SolveTables {
    let mut rb_run: Vec<i32> = vec![];
    for e in 0..fz.ne {
        if fz.ekey[e] >= 0 && fz.meter[e] != 0 && !rb_run.contains(&fz.ekey[e]) {
            rb_run.push(fz.ekey[e]);
        }
    }
    let mut rb_shell: Vec<i32> = vec![];
    for e in 0..fz.ne {
        if fz.shell_of[e] >= 0 && !rb_shell.contains(&fz.shell_of[e]) {
            rb_shell.push(fz.shell_of[e]);
        }
    }
    let mut rb_sgtr: Vec<i32> = vec![];
    for e in 0..fz.ne {
        if fz.is_sgtr[e] != 0 && fz.ekey[e] >= 0 && !rb_sgtr.contains(&fz.ekey[e]) {
            rb_sgtr.push(fz.ekey[e]);
        }
    }
    let mut rb_by: Vec<i32> = vec![];
    for e in 0..fz.ne {
        if fz.is_break[e] != 0 && fz.ekey[e] >= 0 && !rb_by.contains(&fz.ekey[e]) {
            rb_by.push(fz.ekey[e]);
        }
    }
    let run_pos = pos_of(&rb_run);
    let tank_pos = pos_of(&fz.tank_keys);
    let shell_pos = pos_of(&rb_shell);
    let sgtr_pos = pos_of(&rb_sgtr);
    let relief_pos = pos_of(&fz.relief_keys);
    let by_pos = pos_of(&rb_by);
    let core_pos = pos_of(&fz.core_keys);
    let max_stab = fz.ekey.iter().chain(fz.shell_of.iter()).filter(|&&x| x >= 0).max().unwrap_or(&-1);
    let mut loop_stab = vec![-1i32; (*max_stab).max(0) as usize + 1];
    for (pos, &rk) in fz.run_keys.iter().enumerate() {
        if rk >= 0 && (rk as usize) < loop_stab.len() {
            loop_stab[rk as usize] = fz.loop_of_run[pos];
        }
    }
    let mut tank_nodes = vec![0u8; fz.n];
    for (k, &tn) in fz.tank_order.iter().enumerate() {
        if fz.tank_hold[k] == 0 {
            tank_nodes[tn as usize] = 1;
        }
    }
    let in_core: Vec<bool> = fz.core_set.iter().map(|&x| x != 0).collect();
    let field_struct = field::FieldStruct {
        vol: fz.vol.clone(),
        run_mask: fz.run_mask.clone(),
        curve_of: fz.curve_of.clone(),
        gas_nodes: fz.gas_nodes.clone(),
        liq_nodes: fz.liq_nodes.clone(),
        cond_v: fz.cond_v.clone(),
        cont_mask: fz.cont_mask.clone(),
    };
    SolveTables {
        run_pos, tank_pos, shell_pos, sgtr_pos, relief_pos, by_pos, core_pos,
        loop_stab, tank_nodes, in_core, run_order: rb_run, field_struct,
    }
}

/// One `netSolve` + reads + nat wrapper (= `netFlowK` body, pipenet.js:2965).
/// Field phase shared by replay and live paths (idempotent on repeat: the
/// lp/lh/lm memo skips settled nodes, the tail passes recompute identically).
#[allow(clippy::too_many_arguments)]
pub fn solve_field(
    tb: &SolveTables,
    fz: &SolveFrozen,
    curves: &[eos::Curve],
    carried: &mut SolveCarried,
    pb_v: &[f64],
    pb_has: &[u8],
    mb_v: &[f64],
    mb_has: &[u8],
    hb_v: &[f64],
    hb_has: &[u8],
    fallback_p: &[f64],
    fallback_h: &[f64],
    pool_lvl: &[Option<f64>],
) {
    let samp = field::FieldSample {
        pb_v,
        pb_has,
        hb_v,
        hb_has,
        mb_v,
        mb_has,
        w_arr: &carried.warr,
        edge_u: &fz.eu,
        edge_v: &fz.ev,
        fallback_p,
        fallback_h,
        pool_lvl,
    };
    let mut s3 = [0.0; 3];
    field::field_update(&tb.field_struct, curves, &mut carried.fs, &samp, &mut s3);
}

/// Inputs: canonical bags (pre-tick S), carried scratch, dumped tail.
/// Outputs `SolveOut` + updated carried. Forward-only (no compares).
#[allow(clippy::too_many_arguments)]
pub fn solve_tick(
    fz: &SolveFrozen,
    curves: &[eos::Curve],
    carried: &mut SolveCarried,
    pb_v: &[f64],
    pb_has: &[u8],
    mb_v: &[f64],
    mb_has: &[u8],
    hb_v: &[f64],
    hb_has: &[u8],
    level: f64,
    inp: &SolveIn,
    warns: &mut u32,
) -> SolveOut {
    // Store/pin readers still dumped until their stages port.
    let tail = inp.tail;
    let tb = solve_tables(fz);
    let n = fz.n;
    let ne = fz.ne;
    let sp = level;
    // ---- 1. field ----
    solve_field(
        &tb, fz, curves, carried, pb_v, pb_has, mb_v, mb_has, hb_v, hb_has,
        inp.fallback_p, inp.fallback_h, inp.pool_lvl,
    );
    let fs = &mut carried.fs;
    if std::env::var("PROBE_DEBUG").is_ok() {
        let (mn, mx) = fs.p.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), &v| (a.min(v), b.max(v)));
        eprintln!("rsfield p[{mn},{mx}]");
    }
    // ---- fixed inputs for ref ----
    let sp = level;
    // ---- 2. edges ----
    let field = hydro::FlowField {
        p: &fs.p,
        x: Some(&fs.x),
        wet: Some(&fs.wet),
        void_: Some(&fs.void_),
        rho_d: &fs.rho_d,
        rho_g: &fs.rho_g,
        rho_l: &fs.rho_l,
    };
    let mut gh_g = vec![0.0; ne];
    let mut gh_h = vec![0.0; ne];
    let mut warr = carried.warr.clone();
    if std::env::var("PROBE_DEBUG").is_ok() && carried.warr.len() < 300 {
        let s: f64 = warr.iter().sum();
        eprintln!("rswarr sum={s} len={}", warr.len());
    }
    let mut choke_state = carried.choke;
    let opt = |v: i32| if v < 0 { None } else { Some(v as usize) };
    for e in 0..ne {
        let q = &inp.edge_q[e];
        let gv = &inp.edge_gates[e];
        let (kin, hin, wraw) = edge_inputs(fz, &fs, &warr, q, gv, e);
        let cc = edge::edge_cval(&kin);
        let (g, h, ch) = if fz.g_is_fn[e] != 0 && cc > 0.0 {
            let (g, h, ch) = edge::edge_gh(
                cc, &hin, &field, fz.eu[e] as usize, fz.ev[e] as usize, fz.diode_s[e],
                opt(fz.choke_at[e]), opt(fz.gas_at[e]), opt(fz.liq_at[e]), wraw,
            );
            choke_state = ch;
            (g, h, ch)
        } else if fz.g_is_fn[e] != 0 {
            (0.0, edge::edge_h(&hin, wraw), choke_state)
        } else {
            let gg = if fz.g_scalar[e] != 0.0 && !fz.g_scalar[e].is_nan() {
                fz.g_scalar[e]
            } else {
                0.0
            };
            (gg, 0.0, choke_state)
        };
        let h = edge::head_gate(fz.h_is_fn[e] != 0, h, fz.h_scalar[e]);
        gh_g[e] = g;
        gh_h[e] = h;
        if std::env::var("PROBE_DEBUG").is_ok() && e == 39 {
            eprintln!("rsloop39 cc={cc} hsrc={} diode={} choke={} w={wraw} ispump={} ckundef={} h0={} hscl={} ein={} hk={}", q[40], fz.diode_s[e], opt(fz.choke_at[e]).map(|v| v as i32).unwrap_or(-2), bf(q, 32), hin.ck_undef, q[39], q[40], if q[41].is_nan() { 0.0 } else { q[41] }, q[38]);
        }
        if std::env::var("PROBE_DEBUG").is_ok() && (g.abs() > 1e4 || h.abs() > 1e4) {
            eprintln!("biggh e={e} g={g} h={h} ck={} h0={} hsrc={} hk={} w={} cc={cc} is_pump={} ckundef={}", fz.ck[e], q[39], q[40], q[38], wraw, bf(q, 32), hin.ck_undef);
        }
    }
    carried.choke = choke_state;
    // ---- 3. pieces: solve-time dump (the JS rebuilds inside the solve as
    // the field update moves the live sig; a pre-solve cache bit is stale) ----
    let of: Vec<i32> = inp.pc_of.to_vec();
    let npc = inp.pc_npc;
    let live: Vec<u8> = inp.pc_live.to_vec();
    carried.pc_of = of.clone();
    carried.pc_npc = npc;
    carried.pc_live = live.clone();
    // ---- 4. ref ----
    let (p0, anchor) = pieces::ref_frame(npc, sp);
    // ---- 5. fixed ----
    let (fv, fh) = pieces::fixed_fill(
        n, &carried.fix_v, &anchor, &p0, &tail.cont, tail.held, &tail.hold_pins,
        &tail.drum_pins, &tail.tank_pins, &tail.sec_pins, &tail.cond_pins,
    );
    // ---- 6. store ----
    let mut cap = vec![0.0; n];
    let mut src = vec![0.0; n];
    let mut pin = vec![0u8; n];
    let tanks: Vec<store::TankRow> = tail
        .tank_rows
        .iter()
        .enumerate()
        .map(|(k, &(c, p))| store::TankRow { node: fz.tank_order[k], c, p0: p })
        .collect();
    let conds: Vec<store::CondRow> = tail
        .cond_rows
        .iter()
        .enumerate()
        .map(|(k, &(c, w, p0, wrecked, vacuum))| store::CondRow {
            node: fz.cond_v[k],
            c,
            w,
            p0,
            wrecked,
            vacuum,
        })
        .collect();
    let _any = store::net_store(
        n, &fz.vol, &fz.curve_of, curves, &fs.p, &fs.rho, &fs.x, &fs.b, mb_v, mb_has,
        hb_v, hb_has, &tail.fallback_h, tail.held, &fz.hold_nodes, &fz.drum_nodes, &tanks, &conds,
        &mut carried.memo, &mut cap, &mut src, &mut pin,
    );
    // ---- 7. linear ----
    let order = net::net_order(n, &fz.eu, &fz.ev, &fh);
    let nf = order.len();
    let mut row = vec![0u32; n];
    for (k, &f) in order.iter().enumerate() {
        row[f as usize] = k as u32;
    }
    let mut bw = 0usize;
    for e in 0..ne {
        let (a, b) = (fz.eu[e] as usize, fz.ev[e] as usize);
        if fh[a] != 0 || fh[b] != 0 {
            continue;
        }
        let d = (row[a] as i64 - row[b] as i64).unsigned_abs() as usize;
        if d > bw {
            bw = d;
        }
    }
    let cap_arg: Option<&[f64]> = if tail.with_cap { Some(&cap) } else { None };
    let mut aa = vec![0.0; nf * nf];
    let mut bb = vec![0.0; n];
    let mut touch = vec![0u8; n];
    net::net_assemble(
        &fz.eu, &fz.ev, &gh_g, &gh_h, &fv, &fh, cap_arg, Some(&src),
        Some(&row), nf, n, Some(&mut touch), Some(&mut aa), &mut bb,
    );
    let mut deg = vec![0u8; nf.max(1)];
    let mut d0 = vec![0.0; nf.max(1)];
    if std::env::var("PROBE_DEBUG").is_ok() {
        let s: f64 = aa.iter().sum();
        eprintln!("rsAf-pre sum={s} Af0={} Af1={} len={}", aa.get(0).copied().unwrap_or(f64::NAN), aa.get(1).copied().unwrap_or(f64::NAN), aa.len());
        if nf > 0 && nf < 500 {
            let dg: Vec<String> = (0..nf).map(|i| format!("{:e}", aa[i * nf + i])).collect();
            eprintln!("rsdiag-pre {}", dg.join(","));
        }
        {
            let mut v = Vec::new();
            for e in 0..ne {
                if fz.eu[e] == 45 || fz.ev[e] == 45 {
                    v.push(format!("e{e}:g={} h={}", gh_g[e], gh_h[e]));
                }
            }
            eprintln!("rsn45 {}", v.join(" "));
        }
        {
            let mut v = Vec::new();
            for e in 0..ne {
                if fz.eu[e] == 41 || fz.ev[e] == 41 || fz.eu[e] == 43 || fz.ev[e] == 43 {
                    v.push(format!("e{e}:u={} v={} g={} h={}", fz.eu[e], fz.ev[e], gh_g[e], gh_h[e]));
                }
            }
            eprintln!("rsn4143 {}", v.join(" "));
            eprintln!("rscap41 cap41={} src41={} cap43={} src43={} cap45={} src45={}", cap[41], src[41], cap[43], src[43], cap[45], src[45]);
        }
    }
    if nf > 0 {
        net::net_factor(&mut aa, nf, Some(&mut deg), Some(bw), &mut d0);
    }
    if std::env::var("PROBE_DEBUG").is_ok() {
        let s: f64 = aa.iter().sum();
        eprintln!("rsAf-post sum={s} Af0={} Af1={} len={}", aa.get(0).copied().unwrap_or(f64::NAN), aa.get(1).copied().unwrap_or(f64::NAN), aa.len());
        if nf > 0 && nf < 500 {
            let dg: Vec<String> = (0..nf).map(|i| format!("{:e}", aa[i * nf + i])).collect();
            eprintln!("rsdiag-post {}", dg.join(","));
        }
    }
    let mut ccv = vec![0.0; nf];
    for (k, &f) in order.iter().enumerate() {
        ccv[k] = bb[f as usize];
    }
    if nf > 0 {
        net::net_subst(&aa, &mut ccv, nf, Some(bw));
    }
    let mut p = vec![0.0; n];
    for (k, &f) in order.iter().enumerate() {
        p[f as usize] = ccv[k];
    }
    net::net_unfix(&mut p, &fv, &fh, n);
    let mut qq = vec![0.0; ne];
    net::net_flows(&fz.eu, &fz.ev, &gh_g, &gh_h, &p, &fv, &fh, &mut qq);
    if std::env::var("PROBE_DEBUG").is_ok() {
        let mut v = Vec::new();
        for e in 0..ne {
            if fz.work[e] != 0 {
                v.push(format!("e{e}:q={} wfr={}", qq[e], tail.work_fr.get(e).copied().unwrap_or(f64::NAN)));
            }
        }
        eprintln!("rswork {}", v.join(" "));
    }
    carried.warr = qq.clone();
    let mut deg_n = vec![0u8; n];
    for (k, &f) in order.iter().enumerate() {
        deg_n[f as usize] = deg[k];
    }
    // ---- 8. diverge (AfTopo-sig gated like JS: runs only on change,
    // one warn per divergent node) ----
    let mut div_got: Vec<u32> = vec![];
    if carried.div_sig.as_deref() != Some(tail.div_sig.as_str()) {
        let (res, _) =
            net::diverge_check(&fz.eu, &fz.ev, &qq, &fh, Some(&deg_n), Some(&cap), Some(&src), &p, n);
        div_got = res.into_iter().map(|(i, _)| i as u32).collect();
        div_got.sort();
        *warns += tail.widx.len() as u32;
    }
    carried.div_sig = Some(tail.div_sig.clone());
    if std::env::var("PROBE_DEBUG").is_ok() {
        let gs: f64 = gh_g.iter().sum();
        let (gn, gx) = gh_g.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), &v| (a.min(v), b.max(v)));
        let hs: f64 = gh_h.iter().sum();
        let (hn, hx) = gh_h.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), &v| (a.min(v), b.max(v)));
        let bs: f64 = bb.iter().sum();
        let (bn, bx) = bb.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), &v| (a.min(v), b.max(v)));
        eprintln!("rsgh G={gs:e} [{gn},{gx}] H={hs:e} [{hn},{hx}] b={bs:e} [{bn},{bx}]");
        {
            let (mut bi, mut bv) = (0usize, 0.0f64);
            for (e, &g) in gh_g.iter().enumerate() {
                if g > bv {
                    bv = g;
                    bi = e;
                }
            }
            let q = &inp.edge_q[bi];
            eprintln!("rsmaxg e={bi} g={bv} cc={} pu={} pv={} xu={} xv={} wetu={} wetv={} diode={} hsrc={} ckat={:?} gat={:?} lat={:?} w={}", {
                let kin_cc = q[0];
                kin_cc
            }, fs.p[fz.eu[bi] as usize], fs.p[fz.ev[bi] as usize], fs.x[fz.eu[bi] as usize], fs.x[fz.ev[bi] as usize], fs.wet[fz.eu[bi] as usize], fs.wet[fz.ev[bi] as usize], fz.diode_s[bi], q[40], opt(fz.choke_at[bi]), opt(fz.gas_at[bi]), opt(fz.liq_at[bi]), if fz.wi[bi] < 0 { 0.0 } else { warr[fz.wi[bi] as usize] });
            if gh_g.len() > 51 {
                eprintln!("rsg39 g39={} g51={} gisfn39={} gisfn51={}", gh_g[39], gh_g[51], fz.g_is_fn[39], fz.g_is_fn[51]);
            }
            if gh_h.len() > 39 {
                eprintln!("rse39 h39={}", gh_h[39]);
            }
        }
    }
    // ---- 9. readP ----
    let mut by_v = vec![0.0; n];
    let mut by_has = vec![0u8; n];
    read::net_read_p(
        &p, &fh, &touch, &of, npc, &anchor, Some(&deg_n), Some(&pin),
        &fs.wet, &tail.cont_p, &mut by_v, &mut by_has,
    );
    if std::env::var("PROBE_DEBUG").is_ok() {
        let (mn, mx) = p.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), &v| (a.min(v), b.max(v)));
        let (yn, yx) = by_v.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), &v| (a.min(v), b.max(v)));
        eprintln!("readp praw[{mn},{mx}] by[{yn},{yx}] npc={npc} oflen={} anch0={}", of.len(), anchor.get(0).copied().unwrap_or(-999));
        let nfx = fh.iter().map(|&v| v as usize).sum::<usize>();
        let ntc = touch.iter().map(|&v| v as usize).sum::<usize>();
        let (gn, gx) = gh_g.iter().chain(gh_h.iter()).fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), &v| (a.min(v), b.max(v)));
        let (cn, cx) = cap.iter().fold((0.0, 0.0), |(a, b), &v| (a + v, b + v.abs()));
        let (sn, sx) = src.iter().fold((0.0, 0.0), |(a, b), &v| (a + v, b + v.abs()));
        eprintln!("solvein fix={nfx} touch={ntc} gh[{gn},{gx}] capsum={cn} capabs={cx} srcsum={sn} srcabs={sx} nf={nf}");
        eprintln!("rstouch {ntc}/{n}");
        eprintln!("solveorder nf={} order0={:?}", order.len(), &order[..order.len().min(8)]);
        eprintln!("rsorderfull {:?}", order);
        {
            let (mut s, mut mn, mut mx) = (0.0, f64::INFINITY, f64::NEG_INFINITY);
            for i in 0..n {
                if fh[i] != 0 {
                    let v = fv[i];
                    s += v;
                    mn = mn.min(v);
                    mx = mx.max(v);
                }
            }
            eprintln!("solvefixv sum={s:.6} mn={mn} mx={mx}");
        }
    }
    // ---- 10. readEdges (typed path always in march) ----
    let mut re: Vec<read::ReadEdge> = Vec::with_capacity(ne);
    for e in 0..ne {
        re.push(read::ReadEdge {
            u: fz.eu[e],
            v: fz.ev[e],
            key: fz.ekey[e],
            meter: fz.meter[e] != 0,
            pair: fz.pair[e],
            tank_u: tb.tank_nodes[fz.eu[e] as usize] != 0,
            tank_v: tb.tank_nodes[fz.ev[e] as usize] != 0,
            tank_id_u: fz.tank_id_of[fz.eu[e] as usize],
            tank_id_v: fz.tank_id_of[fz.ev[e] as usize],
            shell_of: fz.shell_of[e],
            shell_sign_neg: fz.shell_sign[e] != 0,
            sec_u: fz.sec_shell_of[fz.eu[e] as usize],
            sec_v: fz.sec_shell_of[fz.ev[e] as usize],
            is_sgtr: fz.is_sgtr[e] != 0,
            is_break: fz.is_break[e] != 0,
            break_steam: fz.break_steam[e] != 0,
            break_sec: fz.break_sec[e] != 0,
            work: fz.work[e] != 0,
            work_fr: tail.work_fr[e],
            relief: if fz.fit[e] < 0 {
                -1
            } else {
                fz.relief_keys.iter().position(|&k| k == fz.fit[e]).map(|p| p as i32).unwrap_or(-1)
            },
        });
    }
    let mut by_run = vec![0.0; tb.run_order.len()];
    let mut by_loop_leg: Vec<(i32, f64)> = vec![];
    let mut by_drop_leg: Vec<(i32, f64)> = vec![];
    let mut core_kg_v = vec![0.0; fz.core_keys.len()];
    let n_shell = tb.shell_pos.iter().filter(|&&x| x >= 0).count();
    let n_by = tb.by_pos.iter().filter(|&&x| x >= 0).count();
    let n_sgtr = tb.sgtr_pos.iter().filter(|&&x| x >= 0).count();
    let mut bags = read::OutsBags {
        core_kg: vec![],
        q_tank: vec![0.0; fz.tank_keys.len()],
        sg_steam: vec![0.0; n_shell],
        by: vec![0.0; n_by],
        sg_feed: vec![0.0; n_shell],
        sgtr: vec![0.0; n_sgtr],
        relief: vec![0.0; fz.relief_keys.len()],
        sc: [0.0; 7],
    };
    let mut leg = read::OutsLegacy::default();
    let mut core_tot = 0.0;
    let in_core: Vec<bool> = tb.in_core.clone();
    read::net_read_edges(
        &re, &p, &qq, &fh, &anchor, &fs.wet, &in_core, &fz.core_of, &tb.loop_stab,
        &tb.run_pos, &tb.tank_pos, &tb.shell_pos, &tb.sgtr_pos, &tb.relief_pos, &tb.by_pos,
        &tb.core_pos, Some(&mut by_run), &mut vec![], None, &mut by_loop_leg,
        &mut by_drop_leg, Some(&mut bags), &mut leg, Some(&mut core_kg_v), &mut core_tot,
    );
    let _ = by_drop_leg;
    // `netNatCirc` runs AFTER this solve, on the field this one left; the
    // driver folds its answer into `sc[ONAT]` (`nat_share`).
    // ---- pumpK ----
    let mut total = 0.0;
    for (_, v) in &by_loop_leg {
        total += v;
    }
    let k = total / fz.net_ref;
    let pump_k = if k.is_finite() && k >= 0.0 { k } else { 0.0 };
    SolveOut {
        p_field_v: by_v,
        p_field_has: by_has,
        run_flow_v: by_run,
        edge_kg: qq,
        by_loop_leg,
        sc_v: bags.sc,
        by_v: bags.by,
        sgtr_v: bags.sgtr,
        core_kg_v,
        core_tot,
        leg_sc: [leg.turb_wk, leg.turb_wk_p, leg.turb_wk_a, leg.q_sgtr, leg.spill, leg.spill_sec],
        pump_k,
        heat: 0.0,
        nat_val: bags.sc[read::ONAT],
        div_got,
    }
}

/// SecIn for inv→secTank: everything live (solve + advect + dumped tail).
fn build_sec_in_late(
    meta: &StepMeta,
    st: &StepState,
    tick_in: &StepTick,
    sout: &SolveOut,
    dt: f64,
) -> sec::SecIn {
    let t = &tick_in.sec_tail;
    let mut by_loop = HashMap::new();
    for (k, v) in &sout.by_loop_leg {
        by_loop.insert(k.to_string(), *v);
    }
    let cache = st.advect_cache.as_ref();
    let (adv_pri, adv_sec, landed, ekg, feed_hv, feed_hm, feed_mv) = match cache {
        Some(c) => (
            c.out_pri, c.out_sec, c.landed.clone(), c.edge_kg.clone(),
            c.feed_hv.clone(), c.feed_hm.clone(), c.feed_mv.clone(),
        ),
        None => (0.0, 0.0, vec![], vec![], vec![], vec![], vec![]),
    };
    let feed_mm = cache.map(|c| c.feed_mm.clone()).unwrap_or_default();
    // vent_edges: kind==vent && ekg>0 && key defined (sec-gate.js:694-703).
    let mut vent_edges = vec![];
    for (e, kg) in ekg.iter().enumerate() {
        if meta.sec.edge_kind.get(e).map(|s| s.as_str()) == Some("vent")
            && *kg > 0.0
            && meta.sec.edge_key.get(e).map(|s| !s.is_empty()).unwrap_or(false)
        {
            vent_edges.push((meta.sec.edge_key[e].clone(), *kg));
        }
    }
    if std::env::var("PROBE_DEBUG").is_ok() && !vent_edges.is_empty() {
        eprintln!("ventedges {:?}", vent_edges);
    }
    // core_heat map from live vessel heats (coreHeatBalStep semantics).
    let mut core_heat = HashMap::new();
    for id in &meta.core_ids {
        if let Some(cs) = st.core.get(id.as_str()) {
            core_heat.insert(id.clone(), cs.heat);
        }
    }
    sec::SecIn {
        dt,
        sc_v: sout.sc_v,
        by_typed: true,
        by_v: sout.by_v.clone(),
        by_vals: HashMap::new(),
        q_tank: t.q_tank.clone(),
        relief_v: t.relief_v.clone(),
        sgtr_typed: true,
        sgtr_v: sout.sgtr_v.clone(),
        sgtr_by: HashMap::new(),
        sg_feed: t.sg_feed.clone(),
        sg_steam: t.sg_steam.clone(),
        by_loop,
        run_flow_keys: t.run_flow_keys.clone(),
        run_flow_vals: sout.run_flow_v.clone(),
        advect_out_pri: adv_pri,
        advect_out_sec: adv_sec,
        advect_landed: landed
            .iter()
            .enumerate()
            .map(|(i, v)| (i.to_string(), *v))
            .collect(),
        advect_edge_kg: ekg,
        out_kg: out_maps(meta, cache.map(|c| c.out_kg_v.as_slice()).unwrap_or(&[]), &[]).0,
        shells_live: t.shells_live.clone(),
        vent_edges,
        dgen: t.dgen,
        net_burst_gen: t.net_burst_gen,
        m_by_piece: t.m_by_piece.clone(),
        core_piece: t.core_piece,
        core_pieces: t.core_pieces.clone(),
        cont_rel: t.cont_rel.clone(),
        role_turb_alive: t.role_turb_alive,
        core_heat,
        in_loop_bits: t.in_loop_bits.clone(),
        hold_live: t.hold_live.clone(),
        stage_fed: t.stage_fed.clone(),
        tank_p: t.tank_p.clone(),
        core_fn: t.core_fn.clone(),
        exh_open: t.exh_open,
        feed_in_mv: feed_mv,
        feed_in_hv: feed_hv,
        feed_in_hm: feed_hm,
    }
}

/// outKg/outH2 maps via SecMeta.out_pos over advect vectors
/// (step.js:1553-1556 `outKgV[outPos.get(k)]`; same positions for H2).
fn out_maps(
    meta: &StepMeta,
    kg_v: &[f64],
    h2_v: &[f64],
) -> (HashMap<String, f64>, HashMap<String, f64>) {
    let mut kg = HashMap::new();
    let mut h2 = HashMap::new();
    for (k, pos) in &meta.sec.out_pos {
        if let Some(v) = kg_v.get(*pos) {
            kg.insert(k.clone(), *v);
        }
        if let Some(v) = h2_v.get(*pos) {
            h2.insert(k.clone(), *v);
        }
    }
    (kg, h2)
}
/// One full `stepMarch(dt)` over live state. Tick order mirrors
/// `src/sim/step.js:3744-3857`; each stage section names its JS lines.
/// Returns per-tick compare outputs (warns total, diverge set, ctl out/f).
pub struct StepOut {
    pub warns: u32,
    pub div_got: Vec<u32>,
    pub ctl_out: Vec<f64>,
    pub ctl_f: Vec<f64>,
}

/// One full `stepMarch(dt)` over live state. Tick order mirrors
/// `src/sim/step.js:3744-3857`; each stage section names its JS lines.
pub fn step_replay(meta: &StepMeta, st: &mut StepState, tick_in: &mut StepTick) -> StepOut {
    let mut hook = NoHook;
    step_replay_hook(meta, st, tick_in, &mut hook)
}

/// Stage observation hooks for the live-tail harness (`tail-live` probe).
/// Each fires where the gate captures the matching tail, with the exact
/// live state the readers see. Default no-ops: `step_replay` (and the
/// step-probe gate over it) is behaviorally unchanged.
/// Where the march asks for a tail. The replay has them dumped; the live
/// engine computes them here off the stage-time state.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Stage {
    Rods,
    Solve,
    SecEarly,
    SecLate,
    Trans,
    Room,
    Core,
    Vessel,
    Events,
    Ann,
}

pub trait StageHook {
    /// Fill `tick`'s tails for `at` from live state; no-op replays the dump.
    fn fill(
        &mut self,
        _meta: &StepMeta,
        _st: &StepState,
        _sout: Option<&SolveOut>,
        _at: Stage,
        _tick: &mut StepTick,
    ) {
    }
    /// Live ctl pass. `None` replays the dumped sample.
    fn ctl_replay(
        &mut self,
        _meta: &StepMeta,
        _st: &StepState,
        _tick: &mut StepTick,
    ) -> Option<ctl::Replay> {
        None
    }
    /// `netNatCirc`: the thermosiphon walk after the main solve. It owns the
    /// solver scratch for the duration (it restores `w`, not the field), so
    /// unlike `fill` it takes the state mutably. `None` replays the dump.
    fn nat(&mut self, _meta: &StepMeta, _st: &mut StepState) -> Option<Vec<f64>> {
        None
    }
    fn pre_solve(&mut self, _meta: &StepMeta, _st: &StepState, _tail: &SolveTail) {}
    /// Post-solve, pre-spill: pBy swapped, nothing else ran. The gate's
    /// MISS-path freshPieces reads this exact state.
    fn post_solve(&mut self, _meta: &StepMeta, _st: &StepState, _sout: &SolveOut, _tail: &SolveTail) {}
    fn post_early(&mut self, _meta: &StepMeta, _st: &StepState, _sout: &SolveOut, _tail: &SecTail) {}
    fn pre_advect(&mut self, _meta: &StepMeta, _st: &StepState, _sout: &SolveOut, _tail: &TransTail) {}
    fn post_kinetics(&mut self, _meta: &StepMeta, _st: &StepState, _tails: &HashMap<String, CoreTail>) {}
    fn post_cook(&mut self, _meta: &StepMeta, _st: &StepState, _ann_p: &HashMap<String, f64>, _ann_lvl: &HashMap<String, f64>) {}
    fn post_vessel(&mut self, _meta: &StepMeta, _st: &StepState, _h2: f64) {}
    fn on_tube(&mut self, _meta: &StepMeta, _st: &StepState, _tube: &HashMap<String, TubeTail>) {}
    fn at_end(&mut self, _meta: &StepMeta, _st: &StepState, _tick: &StepTick) {}
}

/// Null hook: replay with zero observation.
pub struct NoHook;
impl StageHook for NoHook {}

/// `step_replay` with a stage hook. The hook fires at gate tail-capture
/// points; it must not mutate state (takes `&StepState`).
pub fn step_replay_hook(
    meta: &StepMeta,
    st: &mut StepState,
    tick_in: &mut StepTick,
    hook: &mut dyn StageHook,
) -> StepOut {
    let dt = tick_in.dt;
    let mut warns: u32 = 0;
    let log0 = st.log.len() as u32;
    let _ = log0;
    // the ledger's opening balance, before anything moves (stepMarch, step.js)
    let sump0 = sump_kg(st.room.grids_f64.get("roomWater").map(|v| v.as_slice()).unwrap_or(&[]));
    let ledg_m0 = events::ledger_kg(&meta.events, &st.events, sump0);
    let ledg_o0 = tick::ledger_out_ordered(&st.events.mass_out_order, &st.events.mass_out);
    // ---- ctlPass (step.js:3752) ----
    let (mut ctl_out, mut ctl_f) = (vec![], vec![]);
    let live_rep = hook.ctl_replay(meta, st, tick_in);
    let rep = match live_rep {
        Some(r) => Some(r),
        None => tick_in.ctl.as_ref().map(ctl::ctl_replay),
    };
    if let Some(rep) = rep {
        ctl_out = rep.out.clone();
        ctl_f = rep.f.clone();
        apply_ctl_replay(&tick_in.ctl_keys, st, &rep);
    }
    // ---- actFollow + boronFollow (3753, 3757; pre-solve SecIn-v0) ----
    load_sec(st);
    {
        let inp0 = build_sec_in_v0(meta, tick_in, dt);
        let mut ev = std::mem::take(&mut st.log);
        let mut cx = sec::Cx {
            meta: &meta.sec,
            curves: &meta.sec_curves,
            st: &mut st.sec,
            inp: &inp0,
            ev: &mut ev,
            warns: &mut warns,
        };
        sec::act_follow(&mut cx);
        sec::boron_follow(&mut cx);
        st.log = ev;
    }
    take_sec(st);
    // actFollow's load lag runs post-CTL-sample; shared S.load evolves.
    if let Some(v) = st.sec.f64s.get("load").copied() {
        st.events.load = v;
    }
    // ---- coreRodStep per vessel (3755) ----
    hook.fill(meta, st, None, Stage::Rods, tick_in);
    for id in &meta.core_ids {
        let k = &meta.core_k[id.as_str()];
        let cs = st.core.get_mut(id.as_str()).unwrap();
        let tail = tick_in.core_tail.get(id.as_str());
        let sink = tail.map(|t| t.sink).unwrap_or(false);
        // tilt_rate is frozen per vessel (dumped in tail).
        let tilt_rate = tail.map(|t| t.tilt_rate).unwrap_or(0.0);
        core::rod_step(k, cs, dt, sink, tilt_rate);
    }
    // ---- coreDecayStep per vessel (3759) ----
    for id in &meta.core_ids {
        let cs = st.core.get_mut(id.as_str()).unwrap();
        core::decay_step(cs, dt);
    }
    // ---- coreAgg#1 (3760) + heat (3761) ----
    sync_core_to_events(meta, st);
    events::core_agg(&meta.events, &mut st.events);
    sync_events_to_sec(st);
    let heat = st.events.n * meta.sec.prompt_f + st.events.decay;
    hook.fill(meta, st, None, Stage::Solve, tick_in);
    hook.pre_solve(meta, st, &tick_in.solve_tail);
    // ---- solve = netFlowK (3777) ----
    load_sec(st);
    let level = st.sec.f64s.get("P").copied().unwrap_or(meta.sec.p0);
    let sin = SolveIn::from_tail(&tick_in.solve_tail);
    let mut sout = solve_tick(
        &meta.solve,
        &meta.solve.curves,
        &mut st.solve_carry,
        &st.p_by.v,
        &st.p_by.has,
        &st.m_by.v,
        &st.m_by.has,
        &st.h_by.v,
        &st.h_by.has,
        level,
        &sin,
        &mut warns,
    );
    // ---- netNatCirc (pipenet.js:2976, inside netFlowK, after the solve) ----
    {
        let nat = hook.nat(meta, st).unwrap_or_else(|| tick_in.solve_tail.nat_loop.clone());
        let tot: f64 = nat.iter().sum();
        let nk = tot / meta.solve.net_ref;
        let v = if nk.is_finite() && nk >= 0.0 { nk } else { 0.0 };
        sout.sc_v[read::ONAT] = v;
        sout.nat_val = v;
    }
    // pField swap (step.js:3789): tickPf = s.pBy; s.pBy = pField.
    st.p_by.v = sout.p_field_v.clone();
    st.p_by.has = sout.p_field_has.clone();
    hook.post_solve(meta, st, &sout, &tick_in.solve_tail);
    if std::env::var("PROBE_DEBUG").is_ok() {
        let (mn, mx) = sout.p_field_v.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), &v| (a.min(v), b.max(v)));
        eprintln!("solve lv={level} heat={heat} p[{mn},{mx}] ekg0={} by0={}", sout.edge_kg.get(0).copied().unwrap_or(f64::NAN), sout.by_v.get(0).copied().unwrap_or(f64::NAN));
        eprintln!("rsekg {}", sout.edge_kg.iter().take(6).map(|v| v.to_string()).collect::<Vec<_>>().join(","));
        eprintln!("rssc {} {} {} {} {} {} {}", sout.sc_v[0], sout.sc_v[1], sout.sc_v[2], sout.sc_v[3], sout.sc_v[4], sout.sc_v[5], sout.sc_v[6]);
        eprintln!("rstb runkeys={} corekeys={} tankkeys={} shellkeys={} sgtrkeys={} reliefkeys={} bykeys={} byrunlen={} bylooplen={}", meta.solve.run_keys.len(), meta.solve.core_keys.len(), meta.solve.tank_keys.len(), meta.solve.shell_keys.len(), meta.solve.sgtr_keys.len(), meta.solve.relief_keys.len(), meta.solve.by_keys.len(), sout.run_flow_v.len(), sout.by_loop_leg.len());
        eprintln!("rsfz work={} secnn={} brk={} shellnn={} keynn={} meter={} pairnn={}", meta.solve.work.iter().map(|&v| v as usize).sum::<usize>(), meta.solve.sec_shell_of.iter().filter(|&&v| v >= 0).count(), meta.solve.is_break.iter().map(|&v| v as usize).sum::<usize>(), meta.solve.shell_of.iter().filter(|&&v| v >= 0).count(), meta.solve.ekey.iter().filter(|&&v| v >= 0).count(), meta.solve.meter.iter().map(|&v| v as usize).sum::<usize>(), meta.solve.pair.iter().filter(|&&v| v >= 0).count());
        // (work-edge qq/work_fr inspected inside solve_tick; see rswork)
    }
    load_sec(st);
    // ---- cwFlowBy refill (3783-3784): summed per condenser over runFlow ----
    {
        let keys = &tick_in.sec_tail.run_flow_keys;
        let flow_of = |k: &str| -> f64 {
            keys.iter().position(|x| x == k).and_then(|i| sout.run_flow_v.get(i).copied()).unwrap_or(0.0)
        };
        // refill per condenser (cond list static per preset; keys stable),
        // then prune ids with no part (JS deletes !partOf every tick).
        for (ci, cid) in meta.sec.cond_ids.iter().enumerate() {
            let paths = meta.sec.cw_paths.get(ci);
            let mut f = 0.0;
            if let Some(qs) = paths {
                let ks: Vec<String> = qs.iter().map(|q| q.0.clone()).collect();
                f = cw_flow_of(&ks, &flow_of);
            }
            st.sec.maps.entry("cwFlowBy".to_string()).or_insert_with(sec::SMap::default).set(cid, f);
        }
        {
            let keep = &meta.sec.part_ids;
            if let Some(m) = st.sec.maps.get_mut("cwFlowBy") {
                let dead: Vec<String> = m.keys.iter().filter(|k| !keep.contains(k)).cloned().collect();
                for k in dead {
                    m.del(&k);
                }
            }
        }
    }
    // ---- coreFlowNetStep per vessel (3781): fills coreFN only; cs.flowNet
    // keeps its pre-tick value until marginStep (3821) copies it over, and
    // coreVesselStep (3816) reads the stale one. No writeback here.
    // ---- pcoreStep (3787): per-vessel coreSetPCore is driver-side
    // (tickPAt over the solved field; folded node; S.P fallback).
    {
        let p_fallback = st.sec.f64s.get("P").copied().unwrap_or(meta.sec.p0);
        for id in &meta.core_ids {
            let fold = meta.sec.fold_map.get(id.as_str()).map(|s| s.as_str()).unwrap_or(id.as_str());
            let node_idx = meta.sec.net_index.get(fold).copied();
            let pc = tick_p_at(&st.p_by.v, &st.p_by.has, node_idx, p_fallback);
            if let Some(cs) = st.core.get_mut(id.as_str()) {
                cs.p_core = pc;
            }
        }
    }
    // ---- pcoreStep (3787) + pressRead (3790) + burstDice (3791) ----
    // (spill 3785 + tankRate 3786 run here too: early SecIn.)
    hook.fill(meta, st, Some(&sout), Stage::SecEarly, tick_in);
    let (inj, inj_ids) = {
        let inp = build_sec_in_early(meta, st, tick_in, &sout, dt);
        let mut ev = std::mem::take(&mut st.log);
        let mut cx = sec::Cx {
            meta: &meta.sec,
            curves: &meta.sec_curves,
            st: &mut st.sec,
            inp: &inp,
            ev: &mut ev,
            warns: &mut warns,
        };
        sec::spill_step(&mut cx);
        let (inj, inj_ids) = sec::tank_rate_step(&mut cx);
        sec::pcore_step(&mut cx);
        sec::press_read(&mut cx);
        sec::burst_dice(&mut cx);
        st.log = ev;
        (inj, inj_ids)
    };
    hook.fill(meta, st, Some(&sout), Stage::SecLate, tick_in);
    hook.post_early(meta, st, &sout, &tick_in.sec_tail);
    take_sec(st);
    hook.fill(meta, st, Some(&sout), Stage::Trans, tick_in);
    hook.pre_advect(meta, st, &sout, &tick_in.trans_tail);
    // ---- advectStep (3794) ----
    {
        let t = &tick_in.trans_tail;
        let tm = &meta.trans;
        let st_nodes = transport::TransportNodes {
            vol: tm.vol.clone(),
            z: tm.z.clone(),
            booked: tm.booked.clone(),
            book_id: tm.book_id.clone(),
            tank_has: tm.tank_has.clone(),
            curve_of: tm.curve_of.clone(),
            metal_kg: tm.metal_kg.clone(),
            metal_tau: tm.metal_tau.clone(),
            metal_ua: tm.metal_ua.clone(),
            in_core: tm.in_core.clone(),
            circ_of: tm.circ_of.clone(),
            ref_thru: tm.ref_thru.clone(),
            anch_skip: tm.anch_skip.clone(),
        };
        let st_edges = transport::TransportEdges {
            u: tm.eu.clone(),
            v: tm.ev.clone(),
            gas_at: tm.gas_at.clone(),
            liq_at: tm.liq_at.clone(),
            is_break: tm.is_break.clone(),
            is_hole: tm.is_hole.clone(),
            steam: tm.steam.clone(),
            sec: tm.sec.clone(),
            opos: tm.opos.clone(),
            n_out: tm.n_out,
        };
        let fs = &st.solve_carry.fs;
        let field = transport::TransportField {
            p: &fs.p,
            x: &fs.x,
            rho: &fs.rho,
            rho_g: &fs.rho_g,
            rho_l: &fs.rho_l,
            wet: &fs.wet,
            void_: &fs.void_,
        };
        let boron_prev = st.sec.f64s.get("boron").copied().unwrap_or(0.0);
        let boron_dem_prev = st.sec.f64s.get("boronDem").copied().unwrap_or(0.0);
        let h2_prev = st.events.h2;
        let samp = transport::TransportSample {
            dt,
            f: field,
            h_v: &st.h_by.v,
            h_has: &st.h_by.has,
            m_v: &st.m_by.v,
            m_has: &st.m_by.has,
            pb_v: &st.p_by.v,
            pb_has: &st.p_by.has,
            fb_p: &t.fb_p,
            fb_h: &t.fb_h,
            b_v: &st.b_by.v,
            b_has: &st.b_by.has,
            c_v: &st.h2_by.v,
            c_has: &st.h2_by.has,
            metal_v: &st.metal.v,
            metal_has: &st.metal.has,
            src: &t.src,
            metal_qv: &t.metal_qv,
            metal_qm: &t.metal_qm,
            booked_kg: &t.booked_kg,
            boron_pin: &t.boron_pin,
            edge_kg_in: &sout.edge_kg,
            tavg_circs: &tm.tavg_circs,
            tavg_prev_t: &t.tavg_prev_t,
            tavg_prev_dt: &t.tavg_prev_dt,
            tavg_in_loop: &t.tavg_in_loop,
            tavg_core_member: &t.tavg_core_member,
            tavg_top: transport::TavgTop { tavg_prev: st.tavg, dtavg_prev: st.dtavg },
            has_boron: tm.has_boron,
            core_node: tm.core_node,
            boron_prev,
            boron_dem_prev,
            h2_prev,
            core_circ: tm.core_circ,
            rise_lo: &tm.rise_lo,
            rise_hi: &tm.rise_hi,
            rise_a: &t.rise_a,
            cond_p0: tm.cond_p0,
            cp_steel: tm.cp_steel,
            h2_rise: tm.h2_rise,
            dry_min_kg: tm.dry_min_kg,
            core_dt_qmin: tm.core_dt_qmin,
            tavg_rate_tau: tm.tavg_rate_tau,
        };
        let out = transport::advect_step(&tm.curves, &st_nodes, &st_edges, &tm.feed_idx, &tm.core_idx, &samp);
        if std::env::var("PROBE_DEBUG").is_ok() {
            eprintln!("rsadv tavg={} dtavg={} tavg_t={:?} tavg_dt={:?}", out.tavg, out.dtavg, out.tavg_t, out.tavg_dt);
            eprintln!("rsflt dwas={:?} tau={}", t.tavg_prev_dt, tm.tavg_rate_tau);
        }
        if std::env::var("PROBE_DEBUG").is_ok() {
            let ci = tm.tavg_circs.get(0).map(|c| c.ci).unwrap_or(-9999);
            let mut nmatch = 0;
            for i in 0..tm.n {
                if tm.circ_of[i] == ci {
                    nmatch += 1;
                }
            }
            let nil: usize = t.tavg_in_loop.iter().map(|&v| v as usize).sum();
            let nmm: usize = t.tavg_core_member.iter().map(|&v| v as usize).sum();
            eprintln!("rstavg ci={ci} ncircmatch={nmatch} inloop={nil} member={nmm} n={} prevt={:?}", tm.n, t.tavg_prev_t);
            for i in 0..tm.n {
                if t.tavg_core_member.get(i).copied().unwrap_or(0) != 0 {
                    eprintln!("rstavgmem i={i} anch={} circ={} inloop={} mhas={} mv={} vol={}", tm.anch_skip[i], tm.circ_of[i], t.tavg_in_loop[i], st.m_by.has.get(i).copied().unwrap_or(9), st.m_by.v.get(i).copied().unwrap_or(f64::NAN), tm.vol[i]);
                }
            }
        }
        // apply bags to canonical
        st.h_by.v = out.h_v;
        st.h_by.has = out.h_has;
        st.m_by.v = out.m_v;
        st.m_by.has = out.m_has;
        st.b_by.v = out.b_v;
        st.b_by.has = out.b_has;
        st.h2_by.v = out.c_v;
        st.h2_by.has = out.c_has;
        st.metal.v = out.metal_v;
        // scalar + map carry
        st.sec.f64s.insert("boron".to_string(), out.boron);
        st.sec.f64s.insert("boronDem".to_string(), out.boron_dem);
        st.events.h2 = out.h2;
        st.tavg = out.tavg;
        st.dtavg = out.dtavg;
        if std::env::var("PROBE_DEBUG").is_ok() {
            eprintln!("rsm62-adv {}", (62..72).map(|i| format!("{}", st.m_by.v.get(i).copied().unwrap_or(f64::NAN))).collect::<Vec<_>>().join(","));
            let mut v = Vec::new();
            for e in 0..meta.solve.ne {
                let (u, vv) = (meta.solve.eu[e] as usize, meta.solve.ev[e] as usize);
                if (62..72).contains(&u) || (62..72).contains(&vv) {
                    v.push(format!("e{e}:{u}>{vv}:q={}", sout.edge_kg[e]));
                }
            }
            eprintln!("rsq62 {}", v.join(" "));
            eprintln!("rsekg61 outekg61={}", out.edge_kg.get(61).copied().unwrap_or(f64::NAN));
            if let Some(c) = st.advect_cache.as_ref() {
                eprintln!("rsekg61 ekg61={} len={}", c.edge_kg.get(61).copied().unwrap_or(f64::NAN), c.edge_kg.len());
            }
            eprintln!("rsseed62 {}", (62..72).map(|i| format!("vol={} fbp={} bk={} mhas={}", tm.vol[i], t.fb_p[i], t.booked_kg[i], st.m_by.has[i])).collect::<Vec<_>>().join(" "));
            eprintln!("rsh62 {}", (62..72).map(|i| format!("{}", st.h_by.v.get(i).copied().unwrap_or(f64::NAN))).collect::<Vec<_>>().join(","));
        }
        for (i, tc) in tm.tavg_circs.iter().enumerate() {
            let key = meta
                .sec
                .circ_key_of
                .get(tc.ci as usize)
                .and_then(|o| o.clone())
                .unwrap_or_else(|| tc.ci.to_string());
            st.tavg_by.insert(key.clone(), out.tavg_t.get(i).copied().unwrap_or(0.0));
            st.dtavg_by.insert(key, out.tavg_dt.get(i).copied().unwrap_or(0.0));
        }
        // books into canonical massOut
        book_canonical(&mut st.mass_out, &mut st.mass_out_order, "advect", out.advect_booked);
        // stash advect outputs for late SecIn + room
        st.advect_cache = Some(AdvectCache {
            out_pri: out.out_pri,
            out_sec: out.out_sec,
            landed: out.landed,
            edge_kg: out.edge_kg,
            out_kg_v: out.out_kg_v,
            out_kg_m: out.out_kg_m,
            out_h2_v: out.out_h2_v,
            out_h2_m: out.out_h2_m,
            feed_hv: out.feed_hv,
            feed_hm: out.feed_hm,
            feed_mv: out.feed_mv,
            feed_mm: out.feed_mm,
            core_hv: out.core_hv,
            core_hm: out.core_hm,
        });
    }
    // ---- invStep (3795; late SecIn) ----
    load_sec(st);
    {
        let heat_now = st.events.n * meta.sec.prompt_f + st.events.decay;
        let inp = build_sec_in_late(meta, st, tick_in, &sout, dt);
        let mut ev = std::mem::take(&mut st.log);
        let mut cx = sec::Cx {
            meta: &meta.sec,
            curves: &meta.sec_curves,
            st: &mut st.sec,
            inp: &inp,
            ev: &mut ev,
            warns: &mut warns,
        };
        sec::inv_step(&mut cx);
        st.log = ev;
        let _ = heat_now;
    }
    take_sec(st);
    // ---- sumpStep (3798; room split phase 1) ----
    // Room scratch carried across the middle stages in a driver local.
    load_room(st, true);
    let mut room_sc = room::Scratch::default();
    room_sc.size(meta.room.gw * meta.room.gh);
    room_sc.pgen_cur = st.room_pgen;
    room_sc.cg_it = st.room_cg_it;
    // liqCgIt is a sticky readout (JS leaves it untouched on dry ticks).
    room_sc.liq_it = st.room_liq_it;
    room_sc.gs.x = st.room_gsx.clone();
    room_sc.disp = st.room_disp.clone();
    hook.fill(meta, st, Some(&sout), Stage::Room, tick_in);
    {
        let t = &tick_in.room_tail;
        let spill = st.sec.maps.get("spillBy");
        let relief = st.sec.maps.get("reliefVent");
        let cache = st.advect_cache.as_ref();
        let (out_kg, out_h2) = out_maps(
            meta,
            cache.map(|c| c.out_kg_v.as_slice()).unwrap_or(&[]),
            cache.map(|c| c.out_h2_v.as_slice()).unwrap_or(&[]),
        );
        let inp = room::RoomIn {
            dt,
            spill_keys: spill.map(|m| m.keys.clone()).unwrap_or_default(),
            spill_by: spill
                .map(|m| m.keys.iter().zip(m.vals.iter()).map(|(k, v)| (k.clone(), *v)).collect())
                .unwrap_or_default(),
            relief_keys: relief.map(|m| m.keys.clone()).unwrap_or_default(),
            relief_vent: relief
                .map(|m| m.keys.iter().zip(m.vals.iter()).map(|(k, v)| (k.clone(), *v)).collect())
                .unwrap_or_default(),
            out_kg,
            out_h2,
            bore: t.bore.clone(),
            inj: st.room_inj.clone(),
            cg_it: st.room_cg_it,
            pgen: st.room_pgen,
            gsx: st.room_gsx.clone(),
            disp: st.room_disp.clone(),
        };
        let mut ev = std::mem::take(&mut st.log);
        let g1 = {
            let cx = room::Cx {
                meta: &meta.room,
                curves: &meta.room_curves,
                st: &mut st.room,
                inp: &inp,
                ev: &mut ev,
                warns: &mut warns,
                sc: &mut room_sc,
            };
            cx.live_g()
        };
        {
            let mut cx = room::Cx {
                meta: &meta.room,
                curves: &meta.room_curves,
                st: &mut st.room,
                inp: &inp,
                ev: &mut ev,
                warns: &mut warns,
                sc: &mut room_sc,
            };
            cx.sump_step(&g1);
        }
        st.log = ev;
        // take back massOut/dmg (sump may book flood damage)
        take_room(st);
    }
    // ---- cavStep (3801) → bookTailStep (3810): late SecIn ----
    // Reload: room sump phase booked master since sec's last load (shared S
    // accumulates; a stale sec copy would clobber it on takeback).
    load_sec(st);
    // Room ran after sec (sump hits); its applier scalars are newest. (sgtr
    // has no sec home — nothing reads it there and the stream lacks the key.)
    if let Some(v) = st.room.f64s.get("load").copied() {
        st.sec.f64s.insert("load".to_string(), v);
    }
    if let Some(v) = st.room.u8s.get("bkpLost").copied() {
        st.sec.u8s.insert("bkpLost".to_string(), v);
    }
    let cav_ids = {
        let inp = build_sec_in_late(meta, st, tick_in, &sout, dt);
        let mut ev = std::mem::take(&mut st.log);
        let mut cx = sec::Cx {
            meta: &meta.sec,
            curves: &meta.sec_curves,
            st: &mut st.sec,
            inp: &inp,
            ev: &mut ev,
            warns: &mut warns,
        };
        let cav_ids = sec::cav_step(&mut cx);
        sec::pump_q_step(&mut cx);
        sec::pump_coast_step(&mut cx);
        sec::sg_heat_step(&mut cx, sout.pump_k);
        sec::hold_relief_step(&mut cx);
        sec::disc_tank_step(&mut cx);
        sec::book_tail_step(&mut cx, inj);
        st.log = ev;
        cav_ids
    };
    take_sec(st);
    // coreFatigueStep per vessel if inj>0 (3811).
    if inj > 0.0 {
        for id in &meta.core_ids {
            if let Some(cs) = st.core.get_mut(id.as_str()) {
                cs.fatigue = core::fatigue_step(cs.fatigue, dt, inj);
            }
        }
    }
    // ---- sgtrStep (3812) ----
    {
        let inp = build_sec_in_late(meta, st, tick_in, &sout, dt);
        let mut ev = std::mem::take(&mut st.log);
        let mut cx = sec::Cx {
            meta: &meta.sec,
            curves: &meta.sec_curves,
            st: &mut st.sec,
            inp: &inp,
            ev: &mut ev,
            warns: &mut warns,
        };
        sec::sgtr_step(&mut cx);
        st.log = ev;
    }
    take_sec(st);
    // ---- coreBurstStep (3815) + coreVesselStep (3816) + coreAgg#2 (3817) ----
    hook.fill(meta, st, Some(&sout), Stage::Core, tick_in);
    for id in meta.core_ids.clone() {
        let k = meta.core_k.get(id.as_str()).cloned();
        let k = match k {
            Some(k) => k,
            None => continue,
        };
        let tail = tick_in.core_tail.get(id.as_str()).cloned().unwrap_or_default();
        let mut trip = st.events.vessels.get(id.as_str()).map(|v| v.trip.clone()).unwrap_or_default();
        // burst
        if k.tube {
            if let Some(t) = tick_in.tube.get(id.as_str()) {
                if t.taken {
                    if let Some(cs) = st.core.get_mut(id.as_str()) {
                        cs.n_tube = t.n_tube.clone();
                        cs.tubes_open = t.tubes_open;
                        cs.cav_relief = t.cav_relief;
                        cs.breach = t.breach;
                    }
                    trip = t.trip.clone();
                    // room charge: full roomP grid + scalar (room phase 2
                    // has not run yet, so this lands pre-room like the tick).
                    if !t.room_p_post.is_empty() {
                        st.room
                            .grids_f32
                            .insert("roomP".to_string(), t.room_p_post.clone());
                    }
                    st.events.room_bang = t.room_bang;
                    if t.logged_ch {
                        st.log.push(tick::LogEv::new(tick::SEV_ALARM, tick::EV_TUBE));
                    }
                    if t.logged_sh {
                        st.log.push(tick::LogEv::new(tick::SEV_ALARM, tick::EV_SHIELD));
                    }
                }
            }
        } else {
            let (p_core, fatigue, breach) = match st.core.get(id.as_str()) {
                Some(cs) => (cs.p_core, cs.fatigue, cs.breach),
                None => continue,
            };
            let burst_p = k.p0 * (k.burst_k - 0.0028 * fatigue);
            let (b, t) = core::burst_logic(breach, p_core, burst_p);
            if let Some(cs) = st.core.get_mut(id.as_str()) {
                cs.breach = b;
            }
            if t {
                trip = "VESSEL RUPTURE".to_string();
            }
        }
        // vessel: coreStep + vessel_tail + H2 deposit + writeback
        let heat_v = st.core.get(id.as_str()).map(|cs| cs.heat).unwrap_or(0.0);
        let flow_net = st.core.get(id.as_str()).map(|cs| cs.flow_net).unwrap_or(0.0);
        let mflux = k.flow_k * tick_in.sec_tail.core_fn.get(id.as_str()).copied().unwrap_or(0.0);
        let flow_frac = flow_net.max(0.004);
        let o = {
            let cs = match st.core.get_mut(id.as_str()) {
                Some(cs) => cs,
                None => continue,
            };
            core::core_step(&k, cs, dt, heat_v, tail.sat, tail.v_leak, mflux, flow_frac, tail.h_in, tail.core_dt_max)
        };
        let boron_s = st.sec.f64s.get("boron").copied().unwrap_or(0.0);
        let v_node = st.core.get(id.as_str()).map(|cs| cs.v_node).unwrap_or(0.0);
        let (parts, rho, vf) = core::vessel_tail(&o, k.excess, boron_s, tail.v_leak, v_node);
        let o8 = o.o[8];
        let o9 = o.o[9];
        if let Some(cs) = st.core.get_mut(id.as_str()) {
            cs.parts = parts;
            cs.rho = rho;
            cs.vf = vf;
            cs.void_th = cs.v_node;
            cs.fci = o9;
        }
        if let Some(ev) = st.events.vessels.get_mut(id.as_str()) {
            ev.parts_xe = parts[4];
        }
        // H2 deposit at the vessel node.
        let fold = meta.sec.fold_map.get(id.as_str()).map(|s| s.as_str()).unwrap_or(id.as_str());
        let ni = meta.sec.net_index.get(fold).copied();
        if o8 > 0.0 {
            if let Some(i) = ni {
                let m2 = if st.m_by.has.get(i).copied().unwrap_or(0) != 0 {
                    st.m_by.v.get(i).copied().unwrap_or(f64::NAN)
                } else {
                    tail.h2m2
                };
                if !tail.h2m2none && m2 > meta.sec.dry_min_kg {
                    let pre = st.h2_by.v.get(i).copied().unwrap_or(0.0);
                    let nv = pre + o8 / m2;
                    if st.h2_by.v.len() <= i {
                        st.h2_by.v.resize(i + 1, 0.0);
                        st.h2_by.has.resize(i + 1, 0);
                    }
                    st.h2_by.v[i] = nv;
                    st.h2_by.has[i] = 1;
                }
            }
        }
        // kinetics (3832) + melt (3834) run after the sec chain below;
        // stash burst/vessel trip into the vessel now (coreAgg reads it).
        if let Some(ev) = st.events.vessels.get_mut(id.as_str()) {
            ev.trip = trip;
        }
    }
    hook.on_tube(meta, st, &tick_in.tube);
    sync_core_to_events(meta, st);
    events::core_agg(&meta.events, &mut st.events);
    sync_events_to_sec(st);
    // ---- marginStep (3821) → secTankStep (3828) ----
    let (sec_vent, p_cond, bleed_all) = {
        let inp = build_sec_in_late(meta, st, tick_in, &sout, dt);
        let mut ev = std::mem::take(&mut st.log);
        let mut cx = sec::Cx {
            meta: &meta.sec,
            curves: &meta.sec_curves,
            st: &mut st.sec,
            inp: &inp,
            ev: &mut ev,
            warns: &mut warns,
        };
        sec::margin_step(&mut cx, sout.pump_k);
        // marginStep coreFlowNetSet (3243): fresh coreFN onto the core state.
        // The vessel section above read the pre-tick value, like the sim.
        for id in &meta.core_ids {
            if let Some(v) = inp.core_fn.get(id.as_str()).copied() {
                if let Some(cs) = st.core.get_mut(id.as_str()) {
                    cs.flow_net = v;
                }
            }
        }
        sec::cond_turb_step(&mut cx);
        let (sec_vent, p_cond) = sec::sec_vent_step(&mut cx);
        let bleed_all = sec::shell_step(&mut cx, &sec_vent);
        sec::cond_vent_step(&mut cx);
        sec::turb_step(&mut cx, p_cond, bleed_all);
        sec::rad_panel_step(&mut cx);
        sec::sec_tank_step(&mut cx);
        st.log = ev;
        (sec_vent, p_cond, bleed_all)
    };
    take_sec(st);
    // ---- coreKineticsStep per vessel (3832) ----
    for id in meta.core_ids.clone() {
        let k = match meta.core_k.get(id.as_str()).cloned() {
            Some(k) => k,
            None => continue,
        };
        if let Some(cs) = st.core.get_mut(id.as_str()) {
            if std::env::var("PROBE_DEBUG").is_ok() {
                eprintln!("rskin-pre {id} n={} rho={} rodPos={}", cs.n, cs.rho, cs.rod_pos);
            }
            core::kinetics_step(&k, cs, dt);
            if std::env::var("PROBE_DEBUG").is_ok() {
                eprintln!("rskin-post {id} n={} rho={}", cs.n, cs.rho);
            }
        }
    }
    // ---- coreMeltStep per vessel (3834): latch + mass path + release ----
    hook.post_kinetics(meta, st, &tick_in.core_tail);
    for id in meta.core_ids.clone() {
        let k = match meta.core_k.get(id.as_str()).cloned() {
            Some(k) => k,
            None => continue,
        };
        let tail = tick_in.core_tail.get(id.as_str()).cloned().unwrap_or_default();
        let mut trip = st.events.vessels.get(id.as_str()).map(|v| v.trip.clone()).unwrap_or_default();
        let melt_now = st.core.get(id.as_str()).map(|cs| !cs.melt && cs.melt_frac >= core::MELT_LATCH).unwrap_or(false);
        if melt_now {
            if let Some(cs) = st.core.get_mut(id.as_str()) {
                cs.melt = true;
            }
            trip = "CORE MELT".to_string();
        }
        let (melt_frac, fatigue) = match st.core.get(id.as_str()) {
            Some(cs) => (cs.melt_frac, cs.fatigue),
            None => continue,
        };
        if melt_frac > 0.0 && !tail.catcher {
            let fold = meta.sec.fold_map.get(id.as_str()).map(|s| s.as_str()).unwrap_or(id.as_str());
            let ni = meta.sec.net_index.get(fold).copied();
            let have = ni.and_then(|i| {
                if st.m_by.has.get(i).copied().unwrap_or(0) != 0 {
                    st.m_by.v.get(i).copied()
                } else {
                    None
                }
            });
            let (_nh, bk) = core::melt_mass(have, melt_frac, dt, tail.loop_kg);
            let want = core::MELT_INV * melt_frac * dt / 100.0 * tail.loop_kg;
            if let (Some(i), Some(h)) = (ni, have) {
                let kg = want.min(h.max(0.0));
                if st.m_by.v.len() <= i {
                    st.m_by.v.resize(i + 1, 0.0);
                    st.m_by.has.resize(i + 1, 0);
                }
                st.m_by.v[i] = h - kg;
            }
            book_canonical(&mut st.mass_out, &mut st.mass_out_order, "melt", bk);
            if let Some(cs) = st.core.get_mut(id.as_str()) {
                cs.fatigue = (fatigue + core::MELT_FAT * melt_frac * dt).min(100.0);
            }
        }
        // release: rel = Σ node_w * RELK[fuel_stage] off POST damage.
        let (rel_part, dose) = (tail.rel_part, tail.dose);
        let mut rel = 0.0;
        if let Some(cs) = st.core.get(id.as_str()) {
            for kk in 0..cs.n_melt.len() {
                let stage = core::fuel_stage(
                    cs.n_melt.get(kk).copied().unwrap_or(0.0),
                    cs.n_disp.get(kk).copied().unwrap_or(0.0),
                    cs.n_ox.get(kk).copied().unwrap_or(0.0),
                    cs.n_dmg.get(kk).copied().unwrap_or(0.0),
                    0.0,
                );
                rel += core::node_w(kk) * core::RELK[stage.min(5)];
            }
        }
        if rel > 0.0 {
            let cur = st.sec.f64s.get("release").copied().unwrap_or(0.0);
            st.sec.f64s.insert(
                "release".to_string(),
                (cur + rel * rel_part * dose * dt).min(100.0),
            );
        }
        if let Some(ev) = st.events.vessels.get_mut(id.as_str()) {
            ev.trip = trip;
        }
    }
    hook.fill(meta, st, Some(&sout), Stage::Vessel, tick_in);
    st.events.h2 = tick_in.h2_post_vessel;
    hook.post_vessel(meta, st, tick_in.h2_post_vessel);
    // ---- coreAgg#3 (3835) ----
    sync_core_to_events(meta, st);
    events::core_agg(&meta.events, &mut st.events);
    sync_events_to_sec(st);
    // ---- radDoseStep (3839) ----
    hook.fill(meta, st, Some(&sout), Stage::Events, tick_in);
    {
        let t = &tick_in.events_tail;
        let mut ev = std::mem::take(&mut st.log);
        events::rad_dose_step(&meta.events, &mut st.events, dt, &t.cont_rel, &t.party_cells);
        st.log = ev;
    }
    // ---- injectFluid (3841; node-target fluid only) ----
    {
        let inj = &st.room_inj;
        let node_name = tick_in.inject_node.as_deref().unwrap_or("");
        if inj.present && inj.kind == 2 && !node_name.is_empty() {
            let ni = meta.sec.net_index.get(node_name).copied();
            let have = ni.and_then(|i| {
                if st.m_by.has.get(i).copied().unwrap_or(0) != 0 {
                    st.m_by.v.get(i).copied()
                } else {
                    None
                }
            });
            let r = transport::inject_fluid(have, inj.rate, dt);
            if r.acted {
                if let Some(i) = ni {
                    if st.m_by.v.len() <= i {
                        st.m_by.v.resize(i + 1, 0.0);
                        st.m_by.has.resize(i + 1, 0);
                    }
                    st.m_by.v[i] = r.have;
                    st.m_by.has[i] = 1;
                }
                book_canonical(&mut st.mass_out, &mut st.mass_out_order, "inject", r.booked);
            }
        }
    }
    // ---- roomStep (3842; room split phase 2) ----
    // refresh canonical books (sec booked since sump-phase load; shared S
    // accumulates, so reload before room adds its own). No scalar refresh:
    // room holds sump-phase applier writes newer than sec.
    load_room(st, false);
    {
        // core→room-cores sync (nothing wrote room cores yet this tick).
        for id in &meta.core_ids {
            let (cs, ev) = match (st.core.get(id.as_str()), st.events.vessels.get(id.as_str())) {
                (Some(a), Some(b)) => (a, b),
                _ => continue,
            };
            if let Some(dc) = st.room.cores.get_mut(id.as_str()) {
                dc.breach = cs.breach;
                dc.trip = if ev.trip.is_empty() { None } else { Some(ev.trip.clone()) };
                dc.fatigue = cs.fatigue;
                dc.rod_jam = cs.rod_jam;
                dc.rod_dem = cs.rod_dem;
                dc.tilt_dem = cs.tilt_dem;
                dc.rod_z_dem = cs.rod_zdem.clone();
                dc.rod_pos = cs.rod_pos;
                dc.tilt = cs.tilt;
                dc.rod_z = cs.rod_z.clone();
            }
        }
        // sec→room shared maps (sec wins; room copies stale).
        for key in ["reliefSteam", "sgVentBy", "sgH2By", "sgTBy", "condTBy", "radTBy"] {
            if let Some(m) = st.sec.maps.get(key).cloned() {
                st.room.maps.insert(
                    key.to_string(),
                    room::SMap { keys: m.keys.clone(), vals: m.vals.clone() },
                );
            }
        }
        let t = &tick_in.room_tail;
        let spill = st.sec.maps.get("spillBy");
        let relief = st.sec.maps.get("reliefVent");
        let cache = st.advect_cache.as_ref();
        let (out_kg, out_h2) = out_maps(
            meta,
            cache.map(|c| c.out_kg_v.as_slice()).unwrap_or(&[]),
            cache.map(|c| c.out_h2_v.as_slice()).unwrap_or(&[]),
        );
        let inp = room::RoomIn {
            dt,
            spill_keys: spill.map(|m| m.keys.clone()).unwrap_or_default(),
            spill_by: spill
                .map(|m| m.keys.iter().zip(m.vals.iter()).map(|(k, v)| (k.clone(), *v)).collect())
                .unwrap_or_default(),
            relief_keys: relief.map(|m| m.keys.clone()).unwrap_or_default(),
            relief_vent: relief
                .map(|m| m.keys.iter().zip(m.vals.iter()).map(|(k, v)| (k.clone(), *v)).collect())
                .unwrap_or_default(),
            out_kg,
            out_h2,
            bore: t.bore.clone(),
            inj: st.room_inj.clone(),
            cg_it: st.room_cg_it,
            pgen: st.room_pgen,
            gsx: st.room_gsx.clone(),
            disp: st.room_disp.clone(),
        };
        let mut ev = std::mem::take(&mut st.log);
        let g2 = {
            let cx = room::Cx {
                meta: &meta.room,
                curves: &meta.room_curves,
                st: &mut st.room,
                inp: &inp,
                ev: &mut ev,
                warns: &mut warns,
                sc: &mut room_sc,
            };
            cx.live_g()
        };
        {
            let mut cx = room::Cx {
                meta: &meta.room,
                curves: &meta.room_curves,
                st: &mut st.room,
                inp: &inp,
                ev: &mut ev,
                warns: &mut warns,
                sc: &mut room_sc,
            };
            cx.room_step(&g2);
        }
        st.log = ev;
        // thread back warm-starts + mirror latch scalars (room_replay tail).
        st.room_cg_it = room_sc.cg_it;
        st.room_liq_it = room_sc.liq_it;
        st.room_pgen = room_sc.pgen_cur;
        st.room_gsx = room_sc.gs.x.clone();
        st.room_disp = room_sc.disp.clone();
        st.room.burn_kg = st.room.f("burnKg");
        st.room.burn_p = st.room.f("burnP");
        st.room.burn_blast = st.room.f("burnBlast");
        st.room.fire_kg = st.room.f("fireKg");
        st.room.fire_p = st.room.f("fireP");
        st.room.fire_q = st.room.f("fireQ");
        take_room(st);
        // room → sec skinQ (room owns it; sec chain already ran on last tick's).
        if let Some(m) = st.room.maps.get("skinQ").cloned() {
            st.sec.maps.insert(
                "skinQ".to_string(),
                sec::SMap { keys: m.keys.clone(), vals: m.vals.clone() },
            );
        }
        // refresh roomP extra bag from post-room grid (dump reads it live).
        if let Some(g) = st.room.grids_f32.get("roomP").cloned() {
            st.sec.bags.insert(
                "roomP".to_string(),
                tick::Bag { v: g.iter().map(|&x| x as f64).collect(), has: vec![1u8; g.len()] },
            );
            st.sec.room_p = g.iter().map(|&x| x as f64).collect();
        }
        // refresh sibling sec grids from room grids (same live-read rule).
        if let Some(g) = st.room.grids_f64.get("roomWater").cloned() {
            st.sec.room_water = g.clone();
        }
        if let Some(g) = st.room.grids_f32.get("roomWP").cloned() {
            st.sec.room_wp = g.iter().map(|&x| x as f64).collect();
        } else if let Some(g) = st.room.grids_f64.get("roomWP").cloned() {
            st.sec.room_wp = g.clone();
        }
        if let Some(g) = st.room.grids_f64.get("roomPool").cloned() {
            st.sec.room_pool = g.clone();
        }
        if let Some(g) = st.room.grids_f32.get("roomPoolP").cloned() {
            st.sec.room_pool_p = g.iter().map(|&x| x as f64).collect();
        } else if let Some(g) = st.room.grids_f64.get("roomPoolP").cloned() {
            st.sec.room_pool_p = g.clone();
        }
    }
    // ---- events tail (3845-3854): load canonical + room/sec transfers ----
    load_events(st);
    // room grids → events copies (blast/cook/h2room read them)
    if let Some(g) = st.room.grids_f32.get("roomP") {
        st.events.room_p = g.clone();
    }
    if let Some(g) = st.room.grids_f64.get("roomT") {
        st.events.room_t = g.clone();
    }
    if let Some(g) = st.room.grids_f32.get("roomH2") {
        st.events.room_h2 = g.clone();
    }
    if let Some(g) = st.room.grids_f32.get("roomM") {
        st.events.room_m = g.clone();
    }
    if let Some(g) = st.room.grids_f32.get("roomVap") {
        st.events.room_vap = g.clone();
    }
    // sec → events maps (sec wins).
    if let Some(m) = st.sec.maps.get("sgPBy") {
        let _ = m;
    }
    // tank levels map (discTank wrote sec maps["tank"]).
    if let Some(m) = st.sec.maps.get("tank") {
        st.events.tank.clear();
        for (k, v) in m.keys.iter().zip(m.vals.iter()) {
            st.events.tank.insert(k.clone(), *v);
        }
    }
    // relief cells (reliefCmd updated sec structs during tick).
    for (k, cell) in st.sec.relief.clone() {
        st.events.relief_open.insert(k.clone(), cell.open);
        st.events.relief_blocked.insert(k.clone(), cell.blocked);
        st.events.relief_stuck.insert(k.clone(), cell.stuck);
        st.events.relief_auto.insert(k.clone(), cell.auto);
    }
    // sgBurst flags.
    if let Some(m) = st.sec.bmaps.get("sgBurst") {
        st.events.sg_burst.clear();
        for (k, v) in m.keys.iter().zip(m.vals.iter()) {
            st.events.sg_burst.insert(k.clone(), *v != 0);
        }
    }
    // relief_steam (sec-owned if present).
    if let Some(m) = st.sec.maps.get("reliefSteam") {
        st.events.relief_steam.clear();
        for (k, v) in m.keys.iter().zip(m.vals.iter()) {
            st.events.relief_steam.insert(k.clone(), *v);
        }
    }
    // lvl/sc/tavg-by maps (best-effort same-key copy; gate verifies keys).
    if let Some(m) = st.sec.maps.get("flowDemBy") {
        st.events.flow_demby.clear();
        for (k, v) in m.keys.iter().zip(m.vals.iter()) {
            st.events.flow_demby.insert(k.clone(), *v);
        }
    }
    if let Some(m) = st.sec.maps.get("lvlBy") {
        st.events.lvl_by.clear();
        for (k, v) in m.keys.iter().zip(m.vals.iter()) {
            st.events.lvl_by.insert(k.clone(), *v);
        }
    }
    if let Some(m) = st.sec.maps.get("scBy") {
        st.events.sc_by.clear();
        for (k, v) in m.keys.iter().zip(m.vals.iter()) {
            st.events.sc_by.insert(k.clone(), *v);
        }
    }
    for (k, v) in st.tavg_by.clone() {
        st.events.tavg_by.insert(k, v);
    }
    // mBy canonical → events mby vectors.
    st.events.mby_has = st.m_by.has.clone();
    st.events.mby_v = st.m_by.v.clone();
    // sec scalars → events fields.
    let g = |st: &StepState, k: &str| st.sec.f64s.get(k).copied().unwrap_or(0.0);
    st.events.inj_rate = g(st, "injRate");
    st.events.release = g(st, "release");
    st.events.flow_net = g(st, "flowNet");
    st.events.p = g(st, "P");
    st.events.tavg = g(st, "Tavg");
    st.events.lvl = g(st, "lvl");
    st.events.sc = g(st, "sc");
    st.events.cav = g(st, "cav");
    // room scalars → events fields.
    let rf = |st: &StepState, k: &str| st.room.f64s.get(k).copied().unwrap_or(0.0);
    st.events.room_pmax = rf(st, "roomPMax");
    st.events.room_burn_on = rf(st, "roomBurnOn");
    st.events.room_fire_on = rf(st, "roomFireOn");
    st.events.room_bang = rf(st, "roomBang");
    st.events.room_max = rf(st, "roomMax");
    // events.tick mirrors S.tick, which stepMarch never advances (st.tick is
    // the driver's own march counter for ann timing).
    // part_skin project (events meta.parts order over room partT).
    let mut part_skin = Vec::with_capacity(meta.events.parts.len());
    for p in &meta.events.parts {
        part_skin.push(
            st.room
                .maps
                .get("partT")
                .and_then(|m| m.get(&p.id))
                .unwrap_or(f64::NAN),
        );
    }
    let sump_kg = sump_kg(
        st.room
            .grids_f64
            .get("roomWater")
            .map(|v| v.as_slice())
            .unwrap_or(&[]),
    );
    let cond_p_tail = tick_in.sec_tail.cond_p;
    let bridge = events::DmgBridge {
        part_role: meta.room.part_roles.clone(),
        part_on: meta.room.part_on.clone(),
        nb: meta.room.core_nb.iter().map(|(k, v)| (k.clone(), *v as usize)).collect(),
        tank_hold: meta.room.tank_hold.clone(),
        primary_relief: meta.room.primary_relief.clone(),
    };
    let log0 = st.log.len() as u32;
    {
        let mut ev = std::mem::take(&mut st.log);
        events::blast_step(&meta.events, &mut st.events, &mut ev, dt, &bridge);
        events::overpressure_step(&meta.events, &mut st.events, &mut ev, &bridge, cond_p_tail);
        events::burn_fire_step(&mut st.events, &mut ev);
        events::cook_step(&meta.events, &mut st.events, &mut ev, dt, &bridge, &part_skin);
        st.log = ev;
    }
    hook.fill(meta, st, Some(&sout), Stage::Ann, tick_in);
    hook.post_cook(meta, st, &tick_in.ann_sec_p, &tick_in.ann_boiler_lvl);
    let et = &tick_in.events_tail;
    let stt = &tick_in.sec_tail;
    let ein = events::EventsIn {
        dt,
        cav_ids: cav_ids.clone(),
        inj_ids: inj_ids.clone(),
        runflow: sout.run_flow_v.clone(),
        ledg_m0,
        ledg_o0,
        sump_kg,
        cond_p: stt.cond_p,
        rps_state: et.rps_state.clone(),
        sink_runback: et.sink_runback,
        runback_live: et.runback_live,
        trip_near: tick_in.trip_near_mid,
        dry_ids: et.dry_ids.clone(),
        part_skin,
        panel_hit: et.panel_hit,
        cond_frac: et.cond_frac,
        sec_p: tick_in.ann_sec_p.clone(),
        boiler_lvl: tick_in.ann_boiler_lvl.clone(),
        loopp_by_core: stt.loopp.clone(),
        cont_rel: et.cont_rel.clone(),
        party_cells: et.party_cells.clone(),
        log0,
    };
    {
        let mut ev = std::mem::take(&mut st.log);
        let mut warns_tail = 0u32;
        events::ev_latch_step(&meta.events, &mut st.events, &mut ev, &ein);
        events::repair_step(&mut st.events, &mut ev, dt, &bridge);
        events::flow_spin_step(&meta.events, &mut st.events, &ein.runflow, dt);
        events::ledger_step(&meta.events, &mut st.events, &mut warns_tail, dt, ledg_m0, ledg_o0, sump_kg);
        warns += warns_tail;
        st.log = ev;
    }
    // room→events change-detect for damage-written trip/breach is covered
    // by take_events below only if room cores changed; vessels carry core
    // truth, room cores carry damage truth (compared separately).
    take_events(st);
    // JS holds one shared S.dmgParts/S.dmgWhy array across stages; the
    // per-stage copies above are snapshots. Fan the final master out so the
    // post-tick stage states compare against the same array.
    st.sec.dmg_parts = st.dmg_parts.clone();
    st.sec.dmg_why = st.dmg_why.clone();
    st.room.dmg_parts = st.dmg_parts.clone();
    st.room.dmg_why = st.dmg_why.clone();
    // Same for the mass books: room/events book sump (and ledger) after the
    // last take_sec, while JS shares one S.massOut.
    st.sec.mass_out = st.mass_out.clone();
    st.sec.mass_out_order = st.mass_out_order.clone();
    // burnEv.blast is an events-stage latch on shared S; room dumps it.
    let blast = if st.events.burn_blast { 1.0 } else { 0.0 };
    st.room.f64s.insert("burnBlast".to_string(), blast);
    st.room.burn_blast = blast;
    // Dmg-applier scalars (load 0.05, bkpLost, sgtr): events ran last, so its
    // copies are newest; shared S would show them everywhere post-tick.
    // (sgtr has no sec home — nothing reads it there, stream lacks the key.)
    st.sec.f64s.insert("load".to_string(), st.events.load);
    st.room.f64s.insert("load".to_string(), st.events.load);
    st.sec.u8s.insert("bkpLost".to_string(), st.events.bkp_lost);
    st.room.u8s.insert("bkpLost".to_string(), st.events.bkp_lost);
    st.room.u8s.insert("sgtr".to_string(), st.events.sgtr);
    hook.at_end(meta, st, tick_in);
    StepOut {
        warns,
        div_got: sout.div_got.clone(),
        ctl_out,
        ctl_f,
    }
}

/// Frozen ctl topology: sink key lists in Sample-parallel order (dumped once
/// per preset; the ctl gate repeats them per sample).
#[derive(Clone, Default)]
pub struct CtlMeta {
    pub freg_keys: Vec<String>,
    pub flow_keys: Vec<String>,
    pub valve_keys: Vec<String>,
    pub tank_keys: Vec<String>,
    pub relief_keys: Vec<String>,
    pub core_ids: Vec<String>,
}

/// Apply ctl `Replay` to live state: carried out/f + actuator fan-out to
/// the structs that own each S leaf (sink→leaf map, ctl survey §(2)).
fn apply_ctl_replay(cmeta: &CtlMeta, st: &mut StepState, rep: &ctl::Replay) {
    st.blk_out = rep.out.clone();
    st.blk_f = rep.f.clone();
    live::apply_act(cmeta, st, &rep.act);
}

/// SecIn for actFollow+boronFollow (runs before solve): only dt + dumped
/// piece tables are live; everything else defaults (unread this early).
fn build_sec_in_v0(meta: &StepMeta, tick_in: &StepTick, dt: f64) -> sec::SecIn {
    let _ = meta;
    sec::SecIn {
        dt,
        m_by_piece: tick_in.sec_tail.m_by_piece.clone(),
        core_piece: tick_in.sec_tail.core_piece,
        core_pieces: tick_in.sec_tail.core_pieces.clone(),
        ..Default::default()
    }
}

/// SecIn for spill→burstDice: solve outputs + dumped maps live; advect and
/// late-sec fields still dummy (filled in the late build).
fn build_sec_in_early(
    meta: &StepMeta,
    st: &StepState,
    tick_in: &StepTick,
    sout: &SolveOut,
    dt: f64,
) -> sec::SecIn {
    let _ = (meta, st);
    let t = &tick_in.sec_tail;
    let mut by_loop = HashMap::new();
    for (k, v) in &sout.by_loop_leg {
        by_loop.insert(k.to_string(), *v);
    }
    sec::SecIn {
        dt,
        sc_v: sout.sc_v,
        by_typed: true,
        by_v: sout.by_v.clone(),
        by_vals: HashMap::new(),
        q_tank: t.q_tank.clone(),
        relief_v: t.relief_v.clone(),
        sgtr_typed: true,
        sgtr_v: sout.sgtr_v.clone(),
        sgtr_by: HashMap::new(),
        sg_feed: t.sg_feed.clone(),
        sg_steam: t.sg_steam.clone(),
        by_loop,
        run_flow_keys: t.run_flow_keys.clone(),
        run_flow_vals: sout.run_flow_v.clone(),
        advect_out_pri: 0.0,
        advect_out_sec: 0.0,
        advect_landed: HashMap::new(),
        advect_edge_kg: vec![],
        out_kg: HashMap::new(),
        shells_live: t.shells_live.clone(),
        vent_edges: vec![],
        dgen: t.dgen,
        net_burst_gen: t.net_burst_gen,
        m_by_piece: t.m_by_piece.clone(),
        core_piece: t.core_piece,
        core_pieces: t.core_pieces.clone(),
        cont_rel: t.cont_rel.clone(),
        role_turb_alive: t.role_turb_alive,
        core_heat: HashMap::new(),
        in_loop_bits: t.in_loop_bits.clone(),
        hold_live: t.hold_live.clone(),
        stage_fed: t.stage_fed.clone(),
        tank_p: t.tank_p.clone(),
        core_fn: t.core_fn.clone(),
        exh_open: t.exh_open,
        feed_in_mv: vec![],
        feed_in_hv: vec![],
        feed_in_hm: vec![],
    }
}
/// Load canonical bags + mass/dmg into sec state (pre-block).
/// Tavg/dTavg ride from driver-carried transport state (transport owns them).
/// roomP grid rides from carried room state (region means readers).
/// Driver sync helpers, shared by replay and engine (bag/mass/dmg/agg
/// handoffs between the canonical leaves and stage structs).
pub fn load_sec(st: &mut StepState) {    for (name, bag) in [
        ("pBy", &st.p_by),
        ("hBy", &st.h_by),
        ("mBy", &st.m_by),
        ("bBy", &st.b_by),
        ("h2By", &st.h2_by),
        ("metalT", &st.metal),
    ] {
        st.sec.bags.insert(
            name.to_string(),
            tick::Bag { v: bag.v.clone(), has: bag.has.clone() },
        );
    }
    st.sec.mass_out = st.mass_out.clone();
    st.sec.mass_out_order = st.mass_out_order.clone();
    st.sec.dmg_parts = st.dmg_parts.clone();
    st.sec.dmg_why = st.dmg_why.clone();
    st.sec.f64s.insert("Tavg".to_string(), st.tavg);
    st.sec.f64s.insert("dTavg".to_string(), st.dtavg);
    {
        let mut m = sec::SMap::default();
        for (k, v) in &st.tavg_by {
            m.set(k, *v);
        }
        st.sec.maps.insert("TavgBy".to_string(), m);
    }
    if let Some(g) = st.room.grids_f32.get("roomP") {
        st.sec.bags.insert(
            "roomP".to_string(),
            tick::Bag { v: g.clone(), has: vec![1u8; g.len()] },
        );
    }
}

/// Take back canonical bags + mass/dmg from sec state (post-block).
pub fn take_sec(st: &mut StepState) {
    for (name, bag) in [
        ("pBy", &mut st.p_by),
        ("hBy", &mut st.h_by),
        ("mBy", &mut st.m_by),
        ("bBy", &mut st.b_by),
        ("h2By", &mut st.h2_by),
        ("metalT", &mut st.metal),
    ] {
        if let Some(b) = st.sec.bags.get(name) {
            bag.v = b.v.clone();
            bag.has = b.has.clone();
        }
    }
    st.mass_out = st.sec.mass_out.clone();
    st.mass_out_order = st.sec.mass_out_order.clone();
    st.dmg_parts = st.sec.dmg_parts.clone();
    st.dmg_why = st.sec.dmg_why.clone();
}

/// Load canonical mass/dmg into room state. With scalars=true (sump phase
/// only) also take shared S scalars from sec, which is newest then; the room
/// phase must NOT (room holds sump-phase hits newer than sec).
fn load_room(st: &mut StepState, scalars: bool) {
    st.room.mass_out = st.mass_out.clone();
    st.room.mass_out_order = st.mass_out_order.clone();
    st.room.dmg_parts = st.dmg_parts.clone();
    st.room.dmg_why = st.dmg_why.clone();
    if scalars {
        for k in ["load", "loadDem"] {
            if let Some(v) = st.sec.f64s.get(k).copied() {
                st.room.f64s.insert(k.to_string(), v);
            }
        }
        for k in ["bkpLost", "sgtr"] {
            if let Some(v) = st.sec.u8s.get(k).copied() {
                st.room.u8s.insert(k.to_string(), v);
            }
        }
    }
    // room netPAt/netHAt/pf read live bags (JS reads shared S); room state
    // carries exactly mBy/hBy/pBy (ROOM_BAGKEYS).
    for (name, bag) in [("pBy", &st.p_by), ("hBy", &st.h_by), ("mBy", &st.m_by)] {
        st.room.bags.insert(
            name.to_string(),
            tick::Bag { v: bag.v.clone(), has: bag.has.clone() },
        );
    }
    // room Tavg + TavgBy ride driver-carried transport state (ROOM_F64KEYS /
    // ROOM_MAPKEYS carry Tavg/TavgBy only; room has no dTavg leaves).
    st.room.f64s.insert("Tavg".to_string(), st.tavg);
    {
        let mut m = room::SMap::default();
        for (k, v) in &st.tavg_by {
            m.keys.push(k.clone());
            m.vals.push(*v);
        }
        st.room.maps.insert("TavgBy".to_string(), m);
    }
}

/// Take back canonical mass/dmg from room state.
fn take_room(st: &mut StepState) {
    st.mass_out = st.room.mass_out.clone();
    st.mass_out_order = st.room.mass_out_order.clone();
    st.dmg_parts = st.room.dmg_parts.clone();
    st.dmg_why = st.room.dmg_why.clone();
}

/// Load canonical mass/dmg into events state.
fn load_events(st: &mut StepState) {
    st.events.mass_out = st.mass_out.clone();
    st.events.mass_out_order = st.mass_out_order.clone();
    st.events.dmg_parts = st.dmg_parts.clone();
    st.events.dmg_why = st.dmg_why.clone();
    // condTurbStep (sec stage) latches shared S.turbTrip/S.condLost; evLatch
    // and the post-tick dump read them back.
    st.events.turb_trip = st.sec.b("turbTrip");
    st.events.cond_lost = st.sec.b("condLost");
    // Room ran just before events; its dmg-applier writes (load 0.05,
    // bkpLost, sgtr) are newest. loadDem is actFollow-only (already synced).
    st.events.load = st.room.f("load");
    st.events.bkp_lost = st.room.b("bkpLost");
    st.events.sgtr = st.room.b("sgtr");
}

/// Take back canonical mass/dmg from events state.
fn take_events(st: &mut StepState) {
    st.mass_out = st.events.mass_out.clone();
    st.mass_out_order = st.events.mass_out_order.clone();
    st.dmg_parts = st.events.dmg_parts.clone();
    st.dmg_why = st.events.dmg_why.clone();
}

/// Sync coreAgg aggregates events→sec f64s (sec fns read
/// `cx.st.f("n"/"decay"/"vf"/"heat")`; call immediately after every coreAgg.
/// Deliberately narrow: sec-owned scalars (P/Tavg/load/heat/…) must NOT be
/// overwritten with events copies (pressRead/margin own them).
pub fn sync_events_to_sec(st: &mut StepState) {
    st.sec.f64s.insert("n".to_string(), st.events.n);
    st.sec.f64s.insert("decay".to_string(), st.events.decay);
    st.sec.f64s.insert("vf".to_string(), st.events.vf);
    st.sec.f64s.insert("heat".to_string(), st.events.heat);
}
/// Project CoreState vessels into EventsState.vessels for `core_agg`
/// (events.rs:357 reads vessels; per-vessel control state lives there).
pub fn sync_core_to_events(meta: &StepMeta, st: &mut StepState) {
    for id in &meta.core_ids {
        let cs = match st.core.get(id.as_str()) {
            Some(v) => v,
            None => continue,
        };
        let v = st.events.vessels.get_mut(id.as_str());
        if let Some(ev) = v {
            ev.n = cs.n;
            ev.decay = cs.decay;
            ev.dmg = cs.dmg;
            ev.melt_frac = cs.melt_frac;
            ev.dec = cs.dec.clone();
            ev.tf = cs.tf;
            ev.dnbr = cs.dnbr;
            ev.vf = cs.vf;
            ev.ox_max = cs.ox_max;
            ev.q_ox = cs.q_ox;
            ev.fatigue = cs.fatigue;
            ev.scrammed = cs.scrammed;
            ev.breach = cs.breach;
            ev.melt = cs.melt;
            ev.rod_pos = cs.rod_pos;
            ev.rod_jam = cs.rod_jam;
            ev.rod_band = cs.rod_band;
            ev.rho = cs.rho;
            // parts_xe set from vessel_tail parts in the vessel section.
            ev.tilt = cs.tilt;
            ev.rod_z = cs.rod_z.clone();
            ev.rod_z_dem = cs.rod_zdem.clone();
            ev.tilt_dem = cs.tilt_dem;
            ev.rod_dem = cs.rod_dem;
        }
    }
}

/// Canonical node bag: `{v:F64(n), has:U8(n)}` mirroring `pfNew` shape.
#[derive(Clone, Default)]
pub struct NodeBag {
    pub v: Vec<f64>,
    pub has: Vec<u8>,
}

/// Full-tick state: stage structs + driver-canonical shared leaves.
#[derive(Default)]
pub struct StepState {
    pub sec: sec::SecState,
    pub room: room::RoomState,
    pub events: events::EventsState,
    pub core: HashMap<String, core::CoreState>,
    // Canonical node bags (driver-owned; lent to transport, synced to stages).
    pub m_by: NodeBag,
    pub h_by: NodeBag,
    pub p_by: NodeBag,
    pub b_by: NodeBag,
    pub h2_by: NodeBag,
    pub metal: NodeBag,
    // Canonical ordered bookkeeping.
    pub mass_out: HashMap<String, f64>,
    pub mass_out_order: Vec<String>,
    pub dmg_parts: Vec<String>,
    pub dmg_why: HashMap<String, String>,
    // Carried ctl block outputs (positional over Sample.blocks).
    pub blk_out: Vec<f64>,
    pub blk_f: Vec<f64>,
    // Carried LOG tail (≤240 `LogEv`), driver-managed cap.
    pub log: Vec<tick::LogEv>,
    // Carried room warm-starts (threaded via `RoomReplay`).
    pub room_cg_it: u32,
    pub room_liq_it: u32,
    pub room_pgen: u32,
    pub room_gsx: Vec<f64>,
    pub room_disp: Vec<f64>,
    // Carried Tavg state (transport-owned S leaves).
    pub tavg: f64,
    pub dtavg: f64,
    pub tavg_by: HashMap<String, f64>,
    pub dtavg_by: HashMap<String, f64>,
    // S.inject (ACT-only, static during march; S0-once).
    pub room_inj: room::RoomInject,
    // Stashed advect outputs for late consumers.
    pub advect_cache: Option<AdvectCache>,
    // Solve scratch carried across ticks.
    pub field: FieldCarry,
    pub solve_carry: SolveCarried,
    pub tick: u64,
}

/// Solve scratch carried across ticks (owned here; contents filled in pass 2).
#[derive(Default)]
pub struct FieldCarry {
    pub f_init: bool,
}

/// What the live engine carries between ticks outside `StepState`: the
/// piece labels (`net.pc`/`net.pcSig`), the held thermosiphon answer
/// (`net.natTick/natPBy/natLoop`) and the fixed-set generation
/// (`net.fixMask/fixGen`).
#[derive(Clone, Default)]
pub struct Carry {
    pub pc_of: Vec<i32>,
    pub pc_n: usize,
    pub pc_live: Vec<u8>,
    pub pc_sig: String,
    pub nat_tick: u64,
    pub nat_p_v: Vec<f64>,
    pub nat_p_has: Vec<u8>,
    pub nat_loop: Vec<f64>,
    pub fix_mask: Vec<u8>,
    pub fix_gen: u64,
}

/// Frozen per-preset bundle: stage metas + curves + solve/transport tables.
pub struct StepMeta {
    pub sec: sec::SecMeta,
    pub sec_curves: sec::SecCurves,
    pub room: room::RoomMeta,
    pub room_curves: room::RoomCurves,
    pub events: events::EventsMeta,
    pub core_k: HashMap<String, core::CoreK>,
    pub core_ids: Vec<String>,
    pub solve: SolveFrozen,
    pub trans: TransMeta,
    pub ctl: CtlMeta,
}

/// Full frozen solve tables (solvefull-gate `dumpMeta` order). The driver
/// needs every table the chain reads; all are commission-frozen.
#[derive(Default)]
pub struct SolveFrozen {
    pub n: usize,
    pub ne: usize,
    pub n_loops: usize,
    pub net_ref: f64,
    pub curves: Vec<eos::Curve>,
    pub curve_of: Vec<u32>,
    pub eu: Vec<u32>,
    pub ev: Vec<u32>,
    pub wi: Vec<i32>,
    pub has_i: Vec<u8>,
    pub ii: Vec<i32>,
    pub dz: Vec<f64>,
    pub pool_at: Vec<i32>,
    pub choke_at: Vec<i32>,
    pub gas_at: Vec<i32>,
    pub liq_at: Vec<i32>,
    pub ck: Vec<i32>,
    pub diode_s: Vec<f64>,
    pub bore: Vec<f64>,
    pub llen: Vec<f64>,
    pub k0: Vec<f64>,
    pub hce: Vec<f64>,
    pub cav_n: Vec<f64>,
    pub cav_one: Vec<f64>,
    pub cav_relief: Vec<f64>,
    pub cc0: Vec<f64>,
    pub gate_n: Vec<u32>,
    pub g_is_fn: Vec<u8>,
    pub h_is_fn: Vec<u8>,
    pub g_scalar: Vec<f64>,
    pub h_scalar: Vec<f64>,
    pub ekey: Vec<i32>,
    pub meter: Vec<u8>,
    pub pair: Vec<i32>,
    pub is_break: Vec<u8>,
    pub break_steam: Vec<u8>,
    pub break_sec: Vec<u8>,
    pub is_sgtr: Vec<u8>,
    pub shell_of: Vec<i32>,
    pub shell_sign: Vec<u8>,
    pub work: Vec<u8>,
    pub fit: Vec<i32>,
    pub vol: Vec<f64>,
    pub run_mask: Vec<u8>,
    pub gas_nodes: Vec<u32>,
    pub liq_nodes: Vec<u32>,
    pub cond_v: Vec<u32>,
    pub cont_mask: Vec<u8>,
    pub tank_order: Vec<u32>,
    pub tank_hold: Vec<u8>,
    pub hold_nodes: Vec<u32>,
    pub drum_nodes: Vec<u32>,
    pub core_nodes: Vec<u32>,
    pub core_node: u32,
    pub run_keys: Vec<i32>,
    pub core_keys: Vec<i32>,
    pub tank_keys: Vec<i32>,
    pub shell_keys: Vec<i32>,
    pub sgtr_keys: Vec<i32>,
    pub relief_keys: Vec<i32>,
    pub by_keys: Vec<i32>,
    pub loop_of_run: Vec<i32>,
    pub core_of: Vec<i32>,
    pub tank_id_of: Vec<i32>,
    pub sec_shell_of: Vec<i32>,
    pub core_set: Vec<u8>,
    pub fm: Vec<u32>,
}

/// Per-tick solved outputs (driver-owned; sec/transport/core readers consume).
/// Only typed-path bags (march is always typed; probe asserts legacy empty).
#[derive(Clone, Default)]
pub struct SolveOut {
    pub p_field_v: Vec<f64>,
    pub p_field_has: Vec<u8>,
    pub run_flow_v: Vec<f64>,
    pub edge_kg: Vec<f64>,
    pub by_loop_leg: Vec<(i32, f64)>,
    pub sc_v: [f64; 7],
    pub by_v: Vec<f64>,
    pub sgtr_v: Vec<f64>,
    pub core_kg_v: Vec<f64>,
    pub core_tot: f64,
    pub leg_sc: [f64; 6],
    pub pump_k: f64,
    pub heat: f64,
    pub nat_val: f64,
    pub div_got: Vec<u32>,
}

/// Frozen transport tables for one preset (mirrors transport-probe.rs
/// preset decode + transport-gate.js dumpMeta).
#[derive(Default)]
pub struct TransMeta {
    pub dt: f64,
    pub n: usize,
    pub ne: usize,
    pub eu: Vec<u32>,
    pub ev: Vec<u32>,
    pub vol: Vec<f64>,
    pub z: Vec<f64>,
    pub booked: Vec<u8>,
    pub book_id: Vec<u32>,
    pub tank_has: Vec<u8>,
    pub gas_at: Vec<i32>,
    pub liq_at: Vec<i32>,
    pub is_break: Vec<u8>,
    pub is_hole: Vec<u8>,
    pub steam: Vec<u8>,
    pub sec: Vec<u8>,
    pub opos: Vec<i32>,
    pub n_out: usize,
    pub in_core: Vec<u8>,
    pub circ_of: Vec<i32>,
    pub ref_thru: Vec<f64>,
    pub anch_skip: Vec<u8>,
    pub metal_kg: Vec<f64>,
    pub metal_tau: Vec<f64>,
    pub metal_ua: Vec<f64>,
    pub curves: Vec<eos::Curve>,
    pub curve_of: Vec<u32>,
    pub feed_idx: Vec<u32>,
    pub core_idx: Vec<u32>,
    pub tavg_circs: Vec<transport::TavgCirc>,
    pub core_node: i32,
    pub has_boron: bool,
    pub core_circ: i32,
    pub cond_p0: f64,
    pub cp_steel: f64,
    pub h2_rise: f64,
    pub dry_min_kg: f64,
    pub core_dt_qmin: f64,
    pub tavg_rate_tau: f64,
    pub rise_lo: Vec<u32>,
    pub rise_hi: Vec<u32>,
}

/// Solve inputs: the live-computable leaves travel by value (replay borrows
/// them from the tail, the live engine derives them), while the store/pin
/// readers still arrive dumped until their stages port (`tail`).
pub struct SolveIn<'a> {
    pub edge_q: &'a [Vec<f64>],
    pub edge_gates: &'a [Vec<f64>],
    pub fallback_p: &'a [f64],
    pub fallback_h: &'a [f64],
    pub pool_lvl: &'a [Option<f64>],
    pub pc_of: &'a [i32],
    pub pc_npc: usize,
    pub pc_live: &'a [u8],
    pub tail: &'a SolveTail,
}

impl<'a> SolveIn<'a> {
    /// Replay path: everything borrowed from the dumped tail.
    pub fn from_tail(tail: &'a SolveTail) -> Self {
        SolveIn {
            edge_q: &tail.edge_q,
            edge_gates: &tail.edge_gates,
            fallback_p: &tail.fallback_p,
            fallback_h: &tail.fallback_h,
            pool_lvl: &tail.pool_lvl,
            pc_of: &tail.pc_of,
            pc_npc: tail.pc_npc,
            pc_live: &tail.pc_live,
            tail,
        }
    }
}

/// Per-tick tail bundle: the readers the march cannot compute inline. The
/// replay fills it from the dump, the engine from live state (`StageHook`).
#[derive(Default, Clone)]
pub struct StepTick {
    pub dt: f64,
    pub ctl: Option<ctl::Sample>,
    // Solve tail (edge predicates, pins, rows, fallbacks, nat).
    pub solve_tail: SolveTail,
    // Sec tail (masks, pins, misc readers).
    pub sec_tail: SecTail,
    // Transport tail (advectSrc, books, pins, areas).
    pub trans_tail: TransTail,
    // Core tail per vessel (h_in, sink, fallbacks).
    pub core_tail: HashMap<String, CoreTail>,
    // Tube outcome per vessel (only when taken).
    pub tube: HashMap<String, TubeTail>,
    // S.h2 dumped post-vessel-loop (h2Total fallback unported).
    pub h2_post_vessel: f64,
    // injectFluid node resolution (empty when numeric/absent).
    pub inject_node: Option<String>,
    // Room tail (spill/relief maps, bores).
    pub room_tail: RoomTail,
    // Events tail (rps, sinks, dry, skins-adjacent, party).
    pub events_tail: EventsTail,
    // Mid-tail capture (gate: post-evLatch, streamed after post-state).
    pub trip_near_mid: bool,
    // evLatch-time ann inputs (sec-tail values are pre-transport stale).
    pub ann_sec_p: HashMap<String, f64>,
    pub ann_boiler_lvl: HashMap<String, f64>,
    // Per-tick ctl key lists (fan-out order; pruning-safe).
    pub ctl_keys: CtlMeta,
}

/// Solve-stage dumped readers per tick.
#[derive(Default, Clone)]
pub struct SolveTail {
    pub fallback_p: Vec<f64>,
    pub fallback_h: Vec<f64>,
    pub pool_lvl: Vec<Option<f64>>,
    pub cont: Vec<(u32, f64)>,
    pub held: bool,
    pub cont_p: Vec<f64>,
    pub hold_pins: Vec<(u32, f64)>,
    pub drum_pins: Vec<(u32, f64)>,
    pub tank_pins: Vec<(u32, f64)>,
    pub sec_pins: Vec<(u32, f64)>,
    pub cond_pins: Vec<(u32, f64)>,
    pub tank_rows: Vec<(f64, f64)>,
    pub cond_rows: Vec<(f64, f64, f64, bool, bool)>,
    pub edge_q: Vec<Vec<f64>>,
    pub edge_gates: Vec<Vec<f64>>,
    pub with_cap: bool,
    pub warned: bool,
    pub widx: Vec<u32>,
    pub work_fr: Vec<f64>,
    pub pc_of: Vec<i32>,
    pub pc_npc: usize,
    pub pc_live: Vec<u8>,
    pub nat_loop: Vec<f64>,
    pub div_sig: String,
}

/// Sec-stage dumped readers per tick.
#[derive(Default, Clone)]
pub struct SecTail {
    pub hold_live: Vec<bool>,
    pub stage_fed: Vec<bool>,
    pub tank_p: Vec<f64>,
    pub core_fn: HashMap<String, f64>,
    pub exh_open: bool,
    pub role_turb_alive: i32,
    pub cont_rel: HashMap<String, f64>,
    pub shells_live: HashMap<String, Vec<String>>,
    pub m_by_piece: Vec<i32>,
    pub core_piece: i32,
    pub core_pieces: Vec<i32>,
    pub in_loop_bits: Vec<Vec<bool>>,
    pub dgen: f64,
    pub net_burst_gen: f64,
    pub cond_p: f64,
    pub panel_hit: f64,
    pub cond_frac: f64,
    pub sec_p: HashMap<String, f64>,
    pub boiler_lvl: HashMap<String, f64>,
    pub loopp: HashMap<String, f64>,
    pub q_tank: HashMap<String, f64>,
    pub relief_v: HashMap<String, f64>,
    pub sg_feed: HashMap<String, f64>,
    pub sg_steam: HashMap<String, f64>,
    pub run_flow_keys: Vec<String>,
}

/// Transport-stage dumped readers per tick.
#[derive(Default, Clone)]
pub struct TransTail {
    pub src: Vec<f64>,
    pub metal_qv: Vec<f64>,
    pub metal_qm: Vec<u8>,
    pub booked_kg: Vec<f64>,
    pub boron_pin: Vec<f64>,
    pub fb_p: Vec<f64>,
    pub fb_h: Vec<f64>,
    pub tavg_prev_t: Vec<f64>,
    pub tavg_prev_dt: Vec<f64>,
    pub tavg_in_loop: Vec<u8>,
    pub tavg_core_member: Vec<u8>,
    pub rise_a: Vec<f64>,
}

/// Dumped tube-rupture outcome per vessel (port deferred: plant pipe logic
/// + room charge; taken only on channel rupture — rare).
#[derive(Default, Clone)]
pub struct TubeTail {
    pub taken: bool,
    pub n_tube: Vec<u8>,
    pub tubes_open: f64,
    pub trip: String,
    pub cav_relief: bool,
    pub breach: bool,
    pub room_bang: f64,
    pub room_p_post: Vec<f64>,
    pub logged_ch: bool,
    pub logged_sh: bool,
}

/// Core-stage dumped readers per vessel per tick.
#[derive(Default, Clone)]
pub struct CoreTail {    pub h_in: f64,
    pub sink: bool,
    pub rel_part: f64,
    pub h2m2: f64,
    pub h2m2none: bool,
    pub h2pre: f64,
    pub h2pre_has: bool,
    pub sat: f64,
    pub v_leak: f64,
    pub loop_kg: f64,
    pub core_dt_max: f64,
    pub tilt_rate: f64,
    pub dose: f64,
    pub catcher: bool,
}

/// Room-stage dumped readers per tick (spill/relief transfer replay→replay;
// out_kg/h2 compute via out_pos; inj carried from S0).
#[derive(Default, Clone)]
pub struct RoomTail {
    pub bore: HashMap<String, f64>,
}

/// Events-stage dumped readers per tick.
#[derive(Default, Clone)]
pub struct EventsTail {
    pub rps_state: String,
    pub sink_runback: bool,
    pub runback_live: bool,
    pub dry_ids: Vec<String>,
    pub panel_hit: f64,
    pub cond_frac: f64,
    pub cont_rel: HashMap<String, f64>,
    pub party_cells: Vec<usize>,
}

/// `sumpKg`: sum of standing room water (step.js:1968). Pure over synced grid.
pub fn sump_kg(room_water: &[f64]) -> f64 {
    let mut k = 0.0;
    for i in 0..room_water.len() {
        k += room_water[i];
    }
    k
}

/// `cwFlowOf`: sum of |flow| over a condenser's circulating paths
/// (step.js:338). Paths are frozen per condenser; flows read live run map.
pub fn cw_flow_of(paths: &[String], flow_of: &dyn Fn(&str) -> f64) -> f64 {
    let mut f = 0.0;
    for k in paths {
        f += flow_of(k).abs();
    }
    f
}

/// `coreSetPCore`/`tickPAt` (step.js:18,2805): field pressure at a folded node,
/// falling back to plant pressure when the node holds nothing.
pub fn tick_p_at(p_v: &[f64], p_has: &[u8], node_idx: Option<usize>, p_fallback: f64) -> f64 {
    match node_idx {
        Some(i) if p_has.get(i).copied().unwrap_or(0) != 0 => {
            p_v.get(i).copied().unwrap_or(p_fallback)
        }
        _ => p_fallback,
    }
}

/// Advect outputs stashed for late SecIn + room stage (driver-carried).
#[derive(Default)]
pub struct AdvectCache {
    pub out_pri: f64,
    pub out_sec: f64,
    pub landed: Vec<f64>,
    pub edge_kg: Vec<f64>,
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
}
/// Driver-side `book` onto canonical `massOut`, preserving first-insertion
/// order exactly like JS `book` (step.js:1970; `if(kg)` guard included).
pub fn book_canonical(
    mass_out: &mut HashMap<String, f64>,
    order: &mut Vec<String>,
    name: &str,
    kg: f64,
) {
    if kg != 0.0 {
        if let Some(v) = mass_out.get_mut(name) {
            *v += kg;
        } else {
            mass_out.insert(name.to_string(), kg);
            order.push(name.to_string());
        }
    }
}

/// FNV-1a 64 over the full step state (exact bits, sorted map keys).
/// Engine-self-consistency digest (`sim_digest` export); cross-engine
/// comparison uses the step gate's sdig-tolerance compares, not this.
pub fn sim_digest(st: &StepState) -> u64 {
    const OFF: u64 = 14695981039346656037;
    let mut h = OFF;
    // Canonical bags.
    for b in [&st.m_by, &st.h_by, &st.p_by, &st.b_by, &st.h2_by, &st.metal] {
        for v in &b.v {
            eat_f64(&mut h, *v);
        }
        eat_u64(&mut h, &b.has);
    }
    for k in sorted_keys(&st.mass_out) {
        eat_u64(&mut h, k.as_bytes());
        eat_f64(&mut h, st.mass_out[k]);
    }
    for v in &st.blk_out {
        eat_f64(&mut h, *v);
    }
    for v in &st.blk_f {
        eat_f64(&mut h, *v);
    }
    for e in &st.log {
        eat_u64(&mut h, &[e.sev]);
        eat_u64(&mut h, &e.code.to_le_bytes());
    }
    eat_u64(&mut h, &st.tick.to_le_bytes());
    // Stage structs join the digest in pass 2 (leaf walk over synced fields).
    h
}

fn eat_u64(h: &mut u64, b: &[u8]) {
    const PRIME: u64 = 1099511628211;
    for x in b {
        *h ^= *x as u64;
        *h = h.wrapping_mul(PRIME);
    }
}

fn eat_f64(h: &mut u64, v: f64) {
    eat_u64(h, &v.to_bits().to_le_bytes());
}

fn sorted_keys(m: &HashMap<String, f64>) -> Vec<&String> {
    let mut k: Vec<&String> = m.keys().collect();
    k.sort();
    k
}
