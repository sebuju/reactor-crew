//! sig-verify: rebuild the solve-time live-sig from dump state per tick and
//! compare against the gate sidecar (`pcdec` sigSolve + `sigseg` segments +
//! per-run `siglists`). Post-ctl valve/load come from the ported
//! `act_follow` on snapshot/restored demand maps; every other segment reads
//! the pre-tick state (ctl touches none of it). Diode heads come from dumped
//! lanes via the shared `edge_gh_lanes`.
//! Usage: sig-probe <dump.bin> <dbgfile.txt>
#[path = "shared/probe_common.rs"]
mod common;
use common::{J, jparse, jstrs};
use sim_rs::ingest::*;
use sim_rs::step::{RoomTail, StepTick, step_replay};
use sim_rs::{live, netlive, sec};
use std::collections::{HashMap, HashSet};

struct SigLists {
    tanks: Vec<String>,
    fit_ids: Vec<String>,
    fit_mode: Vec<String>,
}

struct TickSig {
    solve: String,
    tk: Vec<i64>,
    fit_raw: Vec<J>,
    dmg: Vec<String>,
    shut: Vec<String>,
    cor: Vec<i64>,
    dry: i32,
    diode: i32,
    flg: i64,
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let dbg = std::fs::read_to_string(&a[2]).unwrap();
    let mut lists: Vec<SigLists> = vec![];
    // (preset, tick) -> (sigSolve, seg); preset idx = #siglists seen before line.
    let mut solves: HashMap<(usize, usize), String> = HashMap::new();
    let mut segs: HashMap<(usize, usize), TickSig> = HashMap::new();
    let mut saw_lists = 0usize;
    let mut cur_pi = 0usize;
    let mut last_tag: Option<usize> = None;
    for ln in dbg.lines() {
        if ln.starts_with("siglists P=") {
            saw_lists += 1;
            let js = ln.split_once(' ').map(|x| x.1).unwrap_or("{}");
            let js = js.split_once(' ').map(|x| x.1).unwrap_or(js);
            if let J::O(m) = jparse(js) {
                lists.push(SigLists {
                    tanks: m.get("tanks").map(jstrs).unwrap_or_default(),
                    fit_ids: m.get("fitIds").map(jstrs).unwrap_or_default(),
                    fit_mode: m.get("fitMode").map(jstrs).unwrap_or_default(),
                });
            }
            continue;
        }
        // preset idx by tag-0 rollover (siglists logs after its tick 0).
        let tag0 = ln.strip_prefix("pcdec t=").or_else(|| ln.strip_prefix("sigseg t="))
            .and_then(|r| r.split(' ').next().unwrap_or("0").parse::<usize>().ok());
        if let Some(tg) = tag0 {
            if tg == 0 && last_tag.map(|l| l != 0).unwrap_or(false) {
                cur_pi += 1;
            }
            last_tag = Some(tg);
        }
        let pi = cur_pi;
        if let Some(rest) = ln.strip_prefix("pcdec t=") {
            if let Some(ix) = rest.find("sigSolve=") {
                solves.insert((pi, tag0.unwrap_or(0)), rest[ix + 9..].to_string());
            }
        } else if let Some(rest) = ln.strip_prefix("sigseg t=") {
            let tag: usize = rest.split(' ').next().unwrap_or("0").parse().unwrap_or(0);
            let js = rest.split_once(' ').map(|x| x.1).unwrap_or("{}");
            if js.starts_with("ERR") {
                continue;
            }
            if let J::O(m) = jparse(js) {
                let ints = |k: &str| match m.get(k) {
                    Some(J::A(v)) => v.iter().map(|x| match x {
                        J::N(n) => *n as i64,
                        _ => -1,
                    }).collect(),
                    _ => vec![],
                };
                let num = |k: &str| match m.get(k) {
                    Some(J::N(n)) => *n as i32,
                    _ => 0,
                };
                segs.insert((pi, tag), TickSig {
                    solve: String::new(),
                    tk: ints("tk"),
                    fit_raw: match m.get("fit") {
                        Some(J::A(v)) => v.clone(),
                        _ => vec![],
                    },
                    dmg: m.get("dmg").map(jstrs).unwrap_or_default(),
                    shut: m.get("shut").map(jstrs).unwrap_or_default(),
                    cor: ints("cor"),
                    dry: num("dry"),
                    diode: num("diode"),
                    flg: match m.get("flg") {
                        Some(J::N(n)) => *n as i64,
                        _ => -1,
                    },
                });
            }
        }
    }

    let mut c = Cur { b: &bytes, o: 0, trace: false };
    let np = c.u32() as usize;
    let ver = c.u32();
    assert!(format_ok(ver), "dump format {ver}");
    let mut fails = 0u32;
    let mut total = 0u32;
    let mut segfails = 0u32;
    let mut diode_nz = 0u32;
    let mut diode_h0_ok = 0u32;
    for ppi in 0..np {
        let preset = read_preset(&mut c, ver);
        let ncore = preset.core_ids.len();
        let nticks = c.u32() as usize;
        let sl = lists.get(ppi);
        if sl.is_none() {
            println!("== preset {ppi}: no siglists, skip");
            let mut skip_c = Cur { b: &bytes, o: c.o, trace: false };
            for ti in 0..nticks {
                let _ = read_tick(&mut skip_c, &preset.meta, ncore, ppi, ti);
            }
            c.o = skip_c.o;
            continue;
        }
        let sl = sl.unwrap();
        println!("== preset {ppi} nticks={nticks} tanks={} fits={}", sl.tanks.len(), sl.fit_ids.len());
        let mut hist = HashMap::new();
        for &k in &preset.meta.solve.ck {
            *hist.entry(k).or_insert(0usize) += 1;
        }
        let mut histv: Vec<(i32, usize)> = hist.into_iter().collect();
        histv.sort();
        let hfn: usize = preset.meta.solve.h_is_fn.iter().map(|&v| (v != 0) as usize).sum();
        let gfn: usize = preset.meta.solve.g_is_fn.iter().map(|&v| (v != 0) as usize).sum();
        println!("   ck={histv:?} hfn={hfn} gfn={gfn}");
        let mut st = preset.st;
        // diode edge indices in net.diodeEdges order = edge-index order,
        // JS filter `ed => ed.diode` is truthy: NaN/0/undefined all out.
        let diode_idx: Vec<usize> = (0..preset.meta.solve.ne)
            .filter(|&e| preset.meta.solve.diode_s.get(e).copied().unwrap_or(0.0) != 0.0
                && !preset.meta.solve.diode_s.get(e).copied().unwrap_or(0.0).is_nan())
            .collect();
        // pre-solve warr: S0 seed, then previous tick's post-solve holder.
        let mut pre_warr = st.solve_carry.warr.clone();
        for ti in 0..nticks {
            let t = read_tick(&mut c, &preset.meta, ncore, ppi, ti);
            if ti == 0 {
                // lane census on dumped edge_q (which lanes ever fire).
                let mut cnt = HashMap::new();
                let mut pump_n = 0usize;
                for q in &t.solve_tail.edge_q {
                    for (li, &v) in q.iter().enumerate() {
                        if !v.is_nan() {
                            *cnt.entry(li).or_insert(0usize) += 1;
                        }
                    }
                    if q.get(32) == Some(&1.0) {
                        pump_n += 1;
                    }
                }
                let mut cntv: Vec<(usize, usize)> = cnt.into_iter().collect();
                cntv.sort();
                println!("   lanes={cntv:?} pump={pump_n}");
            }
            total += 1;
            // ---- post-ctl state via replayed pass (demands applied, motors lagged)
            let pst = common::replay_postpass(
                &preset.meta,
                sim_rs::step::StepState {
                    sec: st.sec.clone(), events: st.events.clone(), core: st.core.clone(),
                    ..Default::default()
                },
                &t.sample, &t.ctl_keys, t.dt);

            // ---- arms + segments from post-ctl state
            let ref_open = pst.sec.u8s.get("refOpen").copied().unwrap_or(false);
            let mut tank_bits = vec![];
            for tid in &sl.tanks {
                tank_bits.push(live::tank_open_live(&preset.meta, &preset.meta.sec_curves, &pst, tid));
            }
            let mut fits = vec![];
            for (fi, fid) in sl.fit_ids.iter().enumerate() {
                if sl.fit_mode.get(fi).map(|s| s.as_str()) == Some("relief") {
                    fits.push(netlive::FitSig::Relief(netlive::relief_live(
                        ref_open, &pst.events.relief_open, &pst.events.relief_blocked, fid)));
                } else {
                    fits.push(netlive::FitSig::Throttle {
                        map_present: pst.sec.maps.contains_key("valve"),
                        v: pst.sec.maps.get("valve").and_then(|m| m.get(fid)),
                    });
                }
            }
            let dmg = pst.sec.dmg_parts.clone();
            let shut_ordered: Vec<String> = segs.get(&(ppi, ti)).map(|s| s.shut.clone()).unwrap_or_default();
            let shut_set: HashSet<String> = pst.events.port_shut.iter().cloned().collect();
            let js_set: HashSet<String> = shut_ordered.iter().cloned().collect();
            let mut cores = vec![];
            for id in &preset.meta.core_ids {
                match pst.core.get(id) {
                    Some(cs) => cores.push(netlive::CoreFlags { breach: cs.breach, tubes_open: cs.tubes_open, cav_relief: cs.cav_relief }),
                    None => cores.push(netlive::CoreFlags { breach: false, tubes_open: 0.0, cav_relief: false }),
                }
            }
            let dry = netlive::net_dry_sig(&t.wf7);
            // true diode heads from dumped lanes + solve-time field.
            let fs = sim_rs::field::FieldState {
                p: t.wf.clone(), rho: t.wf1.clone(), x: t.wf2.clone(), b: t.wf3.clone(),
                rho_d: t.wf4.clone(), rho_g: t.wf5.clone(), rho_l: t.wf6.clone(),
                wet: t.wf7.clone(), void_: t.wf8.clone(), mu: t.wf9.clone(),
                lp: t.wf10.clone(), lh: t.wf11.clone(), lm: t.wf12.clone(),
            };
            let diodes: Vec<netlive::DiodeEdge> = diode_idx.iter().map(|&e| {
                let (_, h, _) = sim_rs::step::edge_gh_lanes(
                    &preset.meta.solve, &fs, &pre_warr,
                    &t.solve_tail.edge_q[e], &t.solve_tail.edge_gates[e], e, false);
                netlive::DiodeEdge {
                    u: preset.meta.solve.eu[e] as usize,
                    v: preset.meta.solve.ev[e] as usize,
                    diode: preset.meta.solve.diode_s[e],
                    h,
                }
            }).collect();
            let diode = netlive::net_diode_sig(&t.wf, &diodes);
            if std::env::var("SIG_DEBUG").is_ok() && ppi == 0 && ti == 0 {
                for (k, e) in diode_idx.iter().enumerate() {
                    let d = &diodes[k];
                    let term = (t.wf[d.u] - t.wf[d.v] + d.h) * d.diode;
                    eprintln!("diode k={k} e={e} u={} v={} D={} h={:.6} pu={:.6} pv={:.6} term={:.6} shut={}",
                        d.u, d.v, d.diode, d.h, t.wf[d.u], t.wf[d.v], term, term < 0.0);
                }
            }
            let inp = netlive::LiveSigIn {
                tank_bits: &tank_bits,
                fits: &fits,
                dmg: &dmg,
                shut: &shut_ordered,
                cores: &cores,
                dry,
                diode,
                turb_trip: pst.events.turb_trip,
                cond_lost: pst.events.cond_lost,
                load_pos: pst.sec.f64s.get("load").copied().unwrap_or(f64::NAN) > 0.0,
            };
            let got = netlive::net_live_sig_build(&inp);
            let want = solves.get(&(ppi, ti)).cloned().unwrap_or_default();
            if got != want {
                if fails < 12 {
                    println!("preset {ppi} tick {ti}: SIG mismatch\n  got  {got}\n  want {want}");
                }
                fails += 1;
            }
            // segment-level check vs sigseg ground truth
            if let Some(sg) = segs.get(&(ppi, ti)) {
                let mut bad = vec![];
                let tk_got: Vec<i64> = tank_bits.iter().map(|&b| if b { 1 } else { 0 }).collect();
                if tk_got != sg.tk { bad.push(format!("tk {tk_got:?} vs {:?}", sg.tk)); }
                let mut fit_got: Vec<String> = vec![];
                for f in &fits {
                    match f {
                        netlive::FitSig::Relief(b) => fit_got.push(if *b { "1".to_string() } else { "0".to_string() }),
                        netlive::FitSig::Throttle { map_present, v } => {
                            if !map_present || v.is_none() { fit_got.push("U".to_string()); }
                            else if v.unwrap().is_nan() { fit_got.push("N".to_string()); }
                            else { let mut s = String::new(); netlive::js_num_str(v.unwrap(), &mut s); fit_got.push(s); }
                        }
                    }
                }
                let fit_want: Vec<String> = sg.fit_raw.iter().map(|x| match x {
                    J::N(n) => { let mut s = String::new(); netlive::js_num_str(*n, &mut s); s }
                    J::S(s) => s.clone(),
                    _ => "?".to_string(),
                }).collect();
                if fit_got != fit_want { bad.push(format!("fit {fit_got:?} vs {fit_want:?}")); }
                if dmg != sg.dmg { bad.push(format!("dmg {dmg:?} vs {:?}", sg.dmg)); }
                if shut_set != js_set { bad.push(format!("shutset {shut_set:?} vs {js_set:?}")); }
                let cor_got: Vec<i64> = cores.iter().map(|c| (if c.breach { 4 } else { 0 }) | (if c.tubes_open > 0.0 { 2 } else { 0 }) | (if c.cav_relief { 1 } else { 0 })).collect();
                if cor_got != sg.cor { bad.push(format!("cor {cor_got:?} vs {:?}", sg.cor)); }
                if dry != sg.dry { bad.push(format!("dry {dry} vs {}", sg.dry)); }
                if diode != sg.diode { bad.push(format!("diode(h=0) {diode} vs {}", sg.diode)); }
                let flg = (if pst.events.turb_trip { 1 } else { 0 }) | (if pst.events.cond_lost { 2 } else { 0 }) | (if pst.sec.f64s.get("load").copied().unwrap_or(f64::NAN) > 0.0 { 4 } else { 0 });
                if flg != sg.flg { bad.push(format!("flg {flg} vs {}", sg.flg)); }
                if !bad.is_empty() {
                    if segfails < 12 {
                        println!("preset {ppi} tick {ti}: SEG {}", bad.join(" | "));
                    }
                    segfails += 1;
                }
                if sg.diode != 0 { diode_nz += 1; }
                if sg.diode != 0 && diode == sg.diode { diode_h0_ok += 1; }
            }
            // advance truth
            pre_warr = t.wwarr.clone();
            let mut tick = StepTick {
                dt: t.dt,
                ctl: Some(t.sample),
                ctl_keys: t.ctl_keys,
                solve_tail: t.solve_tail,
                sec_tail: t.sec_tail,
                trans_tail: t.trans_tail,
                core_tail: t.core_tail,
                room_tail: RoomTail { bore: t.bore },
                events_tail: t.events_tail,
                trip_near_mid: t.trip_near_mid,
                inject_node: t.inject_node,
                h2_post_vessel: t.h2_post_vessel,
                tube: t.tube,
                ann_sec_p: t.want_ann_sec_p,
                ann_boiler_lvl: t.want_ann_boiler_lvl,
            };
            if st.blk_out.is_empty() && st.blk_f.is_empty() {
                if let Some(s) = tick.ctl.as_ref() {
                    st.blk_out = s.out_pre.clone();
                    st.blk_f = s.f_pre.clone();
                }
            }
            st.tick += 1;
            step_replay(&preset.meta, &mut st, &mut tick);
        }
    }
    println!("sig: ticks={total} full_mismatch={fails} seg_mismatch={segfails} diode_nonzero={diode_nz} diode_h0_match={diode_h0_ok}");
}
