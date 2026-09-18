//! q-verify: derive live edge-Q lanes per tick and compare against the
//! dumped `edge_q` lane-by-lane. Covers the state+frozen lanes (flags,
//! ids, consts, motors); closure lanes (C/turb/sgtr/pump/pool/h0/hSrc/
//! vent/dump/sgOpen) report as pending for the ports batch.
//! Usage: q-probe <dump.bin> <edge-frozen.json>
#[path = "shared/probe_common.rs"]
mod common;
use common::{parse_edge_frozen, replay_postpass};
use sim_rs::ingest::*;
use sim_rs::{edge, netlive};
use std::collections::HashMap;

/// Full `dumpOf` off pre-tick state (probe-side assembly; the live engine
/// threads the same leaves). `tprog` takes the load branch: corpus plants
/// never enter it scrammed (loud NaN if one does — runback needs the
/// frozen cabinet).
fn dump_of_live_dbg(
    meta: &sim_rs::step::StepMeta,
    curves: &sim_rs::sec::SecCurves,
    st: &sim_rs::step::StepState,
    t: &Tick,
    ef: &common::EdgePreset,
) -> String {
    let load = st.sec.f64s.get("load").copied().unwrap_or(1.0);
    let exh = t.sec_tail.exh_open;
    let read = sim_rs::live::cond_p_read(meta, curves, st, &ef.cond_sink_ids, ef.cond_p_des);
    let lost = if st.events.cond_lost { edge::COND_ATM } else { 0.0 };
    let cond_p = sim_rs::eos::js_max(if exh { f64::NAN } else { 0.0 }, sim_rs::eos::js_max(lost, read));
    let over = sim_rs::live::sg_over_frac(meta, curves, st);
    let tprog = if st.events.scrammed {
        f64::NAN
    } else {
        ef.ptref - 18.0 + 18.0 * sim_rs::live::unit_frac(meta, st, ef.rated, load)
    };
    format!("exh={exh} read={read} lost={lost} condp={cond_p} tavg={} tprog={tprog} over={over} dumpP={} scr={} bypass={} condT={:?} sinks={:?} pmap={:?}",
        st.sec.f64s.get("Tavg").copied().unwrap_or(f64::NAN),
        sim_rs::eos::clamp(over / ef.sg_byp_band, 0.0, 1.0) * ef.bypass,
        st.events.scrammed, ef.bypass,
        st.sec.f64s.get("condT").copied(),
        ef.cond_sink_ids,
        st.sec.maps.get("condPBy").map(|m| m.keys.iter().map(|k| (k.clone(), m.get(k).unwrap_or(f64::NAN))).collect::<Vec<_>>()))
}

fn qeq(a: f64, b: f64) -> bool {
    a == b || (a.is_nan() && b.is_nan())
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let frozen = parse_edge_frozen(&std::fs::read_to_string(&a[2]).unwrap());
    // optional per-tick store-hold flag from the gate dbgfile (`hold t=`).
    let mut hold: HashMap<(usize, usize), bool> = HashMap::new();
    // lane-time holdSetP per circuit (`laneenv` hsp object).
    let mut hsp: HashMap<(usize, usize), HashMap<i32, f64>> = HashMap::new();
    if a.len() > 3 {
        let dbg = std::fs::read_to_string(&a[3]).unwrap();
        let mut cur = 0usize;
        let mut last: Option<usize> = None;
        for ln in dbg.lines() {
            let tg = ln.strip_prefix("hold t=").or_else(|| ln.strip_prefix("laneenv t="))
                .and_then(|r| r.split(' ').next().unwrap_or("0").parse::<usize>().ok());
            if let Some(tg) = tg {
                if tg == 0 && last.map(|l| l != 0).unwrap_or(false) {
                    cur += 1;
                }
                last = Some(tg);
            }
            if let Some(rest) = ln.strip_prefix("hold t=") {
                hold.insert((cur, tg.unwrap_or(0)), rest.split(' ').nth(1).unwrap_or("0") != "0");
            } else if let Some(rest) = ln.strip_prefix("laneenv t=") {
                let js = rest.split_once(' ').map(|x| x.1).unwrap_or("{}");
                if let common::J::O(m) = common::jparse(js) {
                    if let Some(common::J::O(hm)) = m.get("hsp") {
                        let mut map = HashMap::new();
                        for (k, v) in hm {
                            if let Ok(ci) = k.parse::<i32>() {
                                if let common::J::N(p) = v {
                                    map.insert(ci, *p);
                                }
                            }
                        }
                        // preset index: shared tag-0 rollover counter.
                        hsp.insert((cur, tg.unwrap_or(0)), map);
                    }
                }
            }
        }
    }
    let mut c = Cur { b: &bytes, o: 0, trace: false };
    let np = c.u32() as usize;
    let ver = c.u32();
    assert!(ver == 1 || ver == 2, "format v1|v2");
    // lane -> mismatches; lane -> first examples
    let mut miss: HashMap<i32, u64> = HashMap::new();
    let mut ex: HashMap<i32, Vec<String>> = HashMap::new();
    let mut max39 = 0.0f64;
    let mut worst39: Vec<(f64, String)> = vec![];
    let mut big39other: Vec<String> = vec![];
    let mut prev39miss = 0u64;
    let mut rel39bytick: HashMap<usize, u64> = HashMap::new();
    let mut big39bytick: HashMap<usize, u64> = HashMap::new();
    // pending-lane census: min/max/constancy per preset.
    let mut cen: HashMap<(usize, usize), (f64, f64, usize)> = HashMap::new();
    let mut total_edges = 0u64;
    for ppi in 0..np {
        let preset = read_preset(&mut c, ppi, ver);
        let ncore = preset.core_ids.len();
        let nticks = c.u32() as usize;
        let ef = &frozen[ppi];
        assert_eq!(ef.edges.len(), preset.meta.solve.ne, "preset {ppi} ne");
        println!("== preset {ppi} nticks={nticks} ne={}", ef.edges.len());
        let fr_lib = common::to_lib_edge(ef);
        let patched = sim_rs::solvelive::patch_curves(&preset.meta.sec_curves, &fr_lib.suggest);
        let mut pre_sec = preset.st.sec.clone();
        let mut pre_ev = preset.st.events.clone();
        let mut pre_core = preset.st.core.clone();
        let mut pre_warr = preset.st.solve_carry.warr.clone();
        let mut prev_fs = preset.st.solve_carry.fs.clone();
        let mut pre_bags: HashMap<String, sim_rs::step::NodeBag> = [
            ("mBy", preset.st.m_by.clone()), ("hBy", preset.st.h_by.clone()),
            ("pBy", preset.st.p_by.clone()), ("bBy", preset.st.b_by.clone()),
            ("h2By", preset.st.h2_by.clone()), ("metalT", preset.st.metal.clone()),
        ].into_iter().map(|(k, v)| (k.to_string(), v)).collect();
        {
            let empty: HashMap<i32, f64> = HashMap::new();
            let hs = hsp.get(&(ppi, 0)).unwrap_or(&empty);
            let sugg: Vec<f64> = (0..24).map(|ci| ef.suggest.get(&ci).copied().unwrap_or(f64::NAN)).collect();
            let mut cis: Vec<i32> = hs.keys().copied().collect();
            cis.sort();
            let mut show = 0;
            for ci in cis {
                let got = sim_rs::live::hold_set_p(&preset.meta, ci, &sugg);
                let want = hs[&ci];
                if got != want && show < 6 {
                    println!("   hsp p{ppi} ci={ci} port={got} lane={want}");
                    show += 1;
                }
            }
        }
        for ti in 0..nticks {
            let t = read_tick(&mut c, &preset.meta, ncore, ppi, ti);
            let meta = &preset.meta;
            let st = replay_postpass(
                meta,
                sim_rs::step::StepState {
                    sec: pre_sec.clone(),
                    events: pre_ev.clone(),
                    core: pre_core.clone(),
                    m_by: pre_bags.get("mBy").cloned().unwrap_or_default(),
                    h_by: pre_bags.get("hBy").cloned().unwrap_or_default(),
                    p_by: pre_bags.get("pBy").cloned().unwrap_or_default(),
                    b_by: pre_bags.get("bBy").cloned().unwrap_or_default(),
                    h2_by: pre_bags.get("h2By").cloned().unwrap_or_default(),
                    metal: pre_bags.get("metalT").cloned().unwrap_or_default(),
                    ..Default::default()
                },
                &t.sample, &t.ctl_keys, t.dt,
            );
            let mut late: Vec<(i32, String)> = vec![];
            let hold_flag = hold.get(&(ppi, ti)).copied().unwrap_or(false);
            let (lq, lgv) = sim_rs::solvelive::lanes_live(
                meta, &patched, &fr_lib, &st, &pre_warr, t.sec_tail.exh_open, hold_flag);
            for e in 0..meta.solve.ne {
                total_edges += 1;
                let q = &t.solve_tail.edge_q[e];
                let fz = &meta.solve;
                if ti == 0 {
                    for &lane in &[8, 9, 10, 14, 15, 16, 17, 18, 19, 33, 34, 35, 36, 37, 39, 40] {
                        let v = q[lane];
                        if v.is_nan() {
                            continue;
                        }
                        cen.entry((ppi, lane)).and_modify(|c| {
                            if v < c.0 { c.0 = v; }
                            if v > c.1 { c.1 = v; }
                            c.2 += 1;
                        }).or_insert((v, v, 1));
                    }
                }
                let tag = format!("p{ppi}t{ti}e{e}");
                let mut chk = |lane: usize, got: f64| {
                    if !qeq(got, q[lane]) {
                        *miss.entry(lane as i32).or_insert(0) += 1;
                        if ex.entry(lane as i32).or_default().len() < 3 {
                            ex.entry(lane as i32).or_default().push(format!("{tag}q{lane} {got} vs {}", q[lane]));
                        }
                    }
                };
                for lane in 0..45 {
                    // q39 scaffolding: formula proven exact off the pre-dance
                    // field below; live lanes leave it NaN (no Ck<0 consumer).
                    if lane == 39 {
                        continue;
                    }
                    chk(lane, lq[e][lane]);
                }
                if !qeq(lq[e][8], q[8]) {
                    late.push((8, format!("{tag}q8 {} vs {} load={:?}", lq[e][8], q[8], st.sec.f64s.get("load").copied())));
                    if late.iter().filter(|(l, _)| *l == 8).count() < 6 {
                        let dbg = dump_of_live_dbg(meta, &patched, &st, &t, ef);
                        late.push((8, format!("{tag}q8 dumpdbg {dbg}")));
                    }
                }
                // q39 mechanism test (formula vs field time; see lanes_live).
                // Scaffolding lanes (no Ck<0 edges consume them); sdig bar.
                // Tails see the PRE-dance field (S0 exact at t0, prev fsolve
                // after); the solve sees the fresh update.
                {
                    let er = &ef.edges[e];
                    let ck = meta.solve.ck[e];
                    let mkfs = |w: &Tick| sim_rs::field::FieldState {
                        p: w.wf.clone(), rho: w.wf1.clone(), x: w.wf2.clone(), b: w.wf3.clone(),
                        rho_d: w.wf4.clone(), rho_g: w.wf5.clone(), rho_l: w.wf6.clone(),
                        wet: w.wf7.clone(), void_: w.wf8.clone(), mu: w.wf9.clone(),
                        lp: w.wf10.clone(), lh: w.wf11.clone(), lm: w.wf12.clone(),
                    };
                    let fs = mkfs(&t);
                    let (_kin, hin, _w) = sim_rs::step::edge_inputs(fz, &fs, &pre_warr, q, &t.solve_tail.edge_gates[e], e);
                    let isp = er.pump.is_some();
                    let g39 = (if isp { hin.pump_head + hin.static_h } else { hin.static_h }) * ef.head_k;
                    let rel39 = (g39 - q[39]).abs() / (g39.abs() + q[39].abs() + 1e-300);
                    let (_kin0, hin0, _w0) = sim_rs::step::edge_inputs(fz, &prev_fs, &pre_warr, q, &t.solve_tail.edge_gates[e], e);
                    let g39p = (if isp { hin0.pump_head + hin0.static_h } else { hin0.static_h }) * ef.head_k;
                    let rel39p = (g39p - q[39]).abs() / (g39p.abs() + q[39].abs() + 1e-300);
                    if !(rel39p <= 1e-6 || (g39p.is_nan() && q[39].is_nan())) {
                        late.push((39, format!("{tag}q39prev {g39p} vs {} rel={rel39p:.2e}", q[39])));
                        prev39miss += 1;
                    }
                    if !(rel39 <= 1e-6 || (g39.is_nan() && q[39].is_nan())) {
                        late.push((39, format!("{tag}q39 {g39} vs {} rel={rel39:.2e}", q[39])));
                        *rel39bytick.entry(ti).or_insert(0) += 1;
                        if rel39 > 1e-3 {
                            *big39bytick.entry(ti).or_insert(0) += 1;
                        }
                    }
                    if rel39.is_finite() {
                        if worst39.len() < 5 || rel39 > worst39[0].0 {
                            worst39.push((rel39, format!("{tag} ck={ck} pump={} got={g39} want={}", er.pump.is_some(), q[39])));
                            worst39.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
                            if worst39.len() > 5 {
                                worst39.remove(0);
                            }
                        }
                        if rel39 > 1e-3 && ti != 0 && big39other.len() < 5 {
                            big39other.push(format!("{tag} ck={ck} pump={} got={g39} want={} rel={rel39:.2e}", er.pump.is_some(), q[39]));
                        }
                    }
                    max39 = max39.max(rel39);
                    chk(40, if er.hsrc_fn { hin.pump_head * ef.head_k } else { 0.0 });
                }
                // q43/44 + gates: throttle positions off post-ctl valves, any Ck.
                {
                    let gv = &t.solve_tail.edge_gates[e];
                    if lgv[e].len() != gv.len() {
                        late.push((-1, format!("{tag} gates len {} vs {}", lgv[e].len(), gv.len())));
                    } else {
                        for (k, got) in lgv[e].iter().enumerate() {
                            if !qeq(*got, gv[k]) {
                                late.push((-2, format!("{tag} gate[{k}] {got} vs {}", gv[k])));
                            }
                        }
                    }
                }
                // (was: q43/44 inline + Ck3-gated valves; now via lanes_live.)
            }
            for (lane, msg) in late.drain(..) {
                *miss.entry(lane).or_insert(0) += 1;
                if ex.entry(lane).or_default().len() < 6 {
                    ex.entry(lane).or_default().push(msg);
                }
            }
            pre_sec = t.want_sec;
            pre_ev = t.want_events;
            pre_core = t.want_core;
            pre_warr = t.wwarr;
            prev_fs = sim_rs::field::FieldState {
                p: t.wf.clone(), rho: t.wf1.clone(), x: t.wf2.clone(), b: t.wf3.clone(),
                rho_d: t.wf4.clone(), rho_g: t.wf5.clone(), rho_l: t.wf6.clone(),
                wet: t.wf7.clone(), void_: t.wf8.clone(), mu: t.wf9.clone(),
                lp: t.wf10.clone(), lh: t.wf11.clone(), lm: t.wf12.clone(),
            };
            for (name, (v, h)) in &t.want_bags {
                pre_bags.insert(name.clone(), sim_rs::step::NodeBag { v: v.clone(), has: h.clone() });
            }
        }
    }
    let mut lanes: Vec<(i32, u64)> = miss.into_iter().collect();
    lanes.sort();
    println!("q: edges={total_edges} mismatched_lanes={lanes:?} maxrel39={max39:.2e} prev39miss={prev39miss}");
    let mut rbt: Vec<(usize, u64)> = rel39bytick.into_iter().collect();
    rbt.sort();
    println!("  rel39bytick={rbt:?}");
    let mut bbt: Vec<(usize, u64)> = big39bytick.into_iter().collect();
    bbt.sort();
    println!("  big39bytick={bbt:?}");
    for (r, s) in worst39.iter().rev() {
        println!("  worst39 rel={r:.3e} {s}");
    }
    for s in &big39other {
        println!("  big39other {s}");
    }
    let mut cenv: Vec<((usize, usize), (f64, f64, usize))> = cen.into_iter().collect();
    cenv.sort_by_key(|(k, _)| *k);
    for ((p, l), (mn, mx, n)) in cenv {
        println!("  census p{p}q{l}: n={n} min={mn} max={mx}");
    }
    for (l, v) in &ex {
        for s in v {
            println!("  lane{l}: {s}");
        }
    }
}
