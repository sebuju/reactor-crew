//! Full-tick replayer for the §6.7 step gate (`node tools/step-gate.js`).
//! Replays one `stepMarch(dt)` per tick from the S0 snapshot (stage states in
//! each probe's own dump format) plus a per-tick bundle (ctl `Sample`,
//! reader-tail values, mid-tail `trip_near`), and demands per-stage
//! post-state agreement with the JS march. Dev-only.
//!
//! Reader/compare code lives in `sim_rs::ingest` (shared with the WASM
//! engine ingest path). If a stage format drifts, the embedded asserts
//! fail loudly here — update the copy from the named source.
#[path = "shared/probe_common.rs"]
mod common;
use common::read_freezes;
use sim_rs::ingest::*;
use sim_rs::step::*;
use std::collections::HashMap;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    // `--live <freeze.bin>`: the engine, built through the `sim_freeze`
    // door, fills every tail off its own state, so the compares below judge
    // a full live march against the JS one instead of a tail replay.
    let mut freezes: Vec<Option<sim_rs::freeze::FreezeIn>> = a.iter().position(|x| x == "--live")
        .map(|i| read_freezes(&a[i + 1]).into_iter().map(Some).collect())
        .unwrap_or_default();
    let show_digest = a.iter().any(|x| x == "--digest");
    let mut c = Cur { b: &bytes, o: 0, trace: std::env::var("PROBE_TRACE").is_ok() };
    let np = c.u32() as usize;
    let ver = c.u32();
    assert!(ver == 1 || ver == 2, "format v1|v2");
    let mut cmp = Cmp { fails: 0, worst: 0.0, worst_at: String::new(), shown: 0 };
    let mut n_samples = 0u32;
    for pi in 0..np {
        // ---- S0: metas + states (shared with the WASM ingest path) ----
        if std::env::var("PROBE_DEBUG").is_ok() {
            eprintln!("preset {pi} S0 o={}", c.o);
        }
        let preset = read_preset(&mut c, pi, ver);
        let meta = preset.meta;
        let mut st = preset.st;
        let core_ids = preset.core_ids;
        let ncore = core_ids.len();
        let nticks = c.u32() as usize;
        let mut eng: Option<sim_rs::engine::Engine> = None;
        for ti in 0..nticks {
            let si = ti;
            n_samples += 1;
            let t = read_tick(&mut c, &meta, ncore, pi, ti);
            let Tick { dt, sample, want_out, want_f, ctl_keys, solve_tail, sec_tail, trans_tail, core_tail, bore, events_tail, trip_near_mid, inject_node, h2_post_vessel, tube, want_sec, want_room, want_cg, want_liq, want_pgen, want_events, want_ann_sec_p, want_ann_boiler_lvl, want_core, want_bags, want_blk_out, want_blk_f, want_tavg, want_dtavg, want_tavg_by, want_dtavg_by, wf, wf1, wf2, wf3, wf4, wf5, wf6, wf7, wf8, wf9, wf10, wf11, wf12, wm0, wm1, wm2, wm3, wm4, wwarr, want_log, want_warns, want_div } = t;
            // === replay ===
            let mut tick = StepTick {
                dt,
                ctl: Some(sample),
                ctl_keys,
                solve_tail,
                sec_tail,
                trans_tail,
                core_tail,
                room_tail: RoomTail { bore },
                events_tail,
                trip_near_mid,
                inject_node,
                h2_post_vessel,
                tube,
                ann_sec_p: want_ann_sec_p,
                ann_boiler_lvl: want_ann_boiler_lvl,
            };
            let log_before = st.log.len();
            let f0 = cmp.fails;
            if let Some(f) = freezes.get_mut(pi).and_then(Option::take) {
                let (fr, lv) = f.ctl();
                eng = Some(sim_rs::engine::Engine::new(&meta, &st, f.edge, f.tail, fr, f.ctl_meta, lv));
            }
            let r = match eng.as_mut() {
                Some(e) => e.step(&meta, &mut st, dt),
                None => {
                    st.tick += 1;
                    step_replay(&meta, &mut st, &mut tick)
                }
            };
            if show_digest {
                println!("tick={ti} digest={:016x}", sim_digest(&st));
            }
            // === compare ===
            cmp_sec_state(&mut cmp, si, "sec", &st.sec, &want_sec);
            cmp_room_state(&mut cmp, si, "room", &st.room, &want_room);
            cmp.exact_u32(si, "room.cg_it", st.room_cg_it, want_cg);
            cmp.exact_u32(si, "room.liq_it", st.room_liq_it, want_liq);
            cmp.exact_u32(si, "room.pgen", st.room_pgen, want_pgen);
            cmp_events_state(&mut cmp, si, "events", &st.events, &want_events);
            for id in &core_ids {
                if let (Some(g), Some(w)) = (st.core.get(id), want_core.get(id)) {
                    cmp_core_state(&mut cmp, si, &format!("core[{id}]"), g, w);
                } else {
                    cmp.fail(si, format!("core[{id}] missing"));
                }
            }
            let bagmap = [
                ("mBy", &st.m_by),
                ("hBy", &st.h_by),
                ("pBy", &st.p_by),
                ("bBy", &st.b_by),
                ("h2By", &st.h2_by),
                ("metalT", &st.metal),
            ];
            for (name, b) in bagmap {
                let w = &want_bags[name];
                cmp_bag(&mut cmp, si, &format!("bag.{name}"), &b.v, &b.has, &w.0, &w.1);
            }
            cmp_vec_f64(&mut cmp, si, "blk_out", &st.blk_out, &want_blk_out);
            cmp_vec_f64(&mut cmp, si, "blk_f", &st.blk_f, &want_blk_f);
            cmp.sdig(si, "tavg", st.tavg, want_tavg);
            cmp.sdig(si, "dtavg", st.dtavg, want_dtavg);
            cmp_map_f64(&mut cmp, si, "tavg_by", &st.tavg_by, &want_tavg_by);
            cmp_map_f64(&mut cmp, si, "dtavg_by", &st.dtavg_by, &want_dtavg_by);
            // solve carried post
            let fs = &st.solve_carry.fs;
            cmp_vec_f64(&mut cmp, si, "F.p", &fs.p, &wf);
            cmp_vec_f64(&mut cmp, si, "F.rho", &fs.rho, &wf1);
            cmp_vec_f64(&mut cmp, si, "F.x", &fs.x, &wf2);
            cmp_vec_f64(&mut cmp, si, "F.b", &fs.b, &wf3);
            cmp_vec_f64(&mut cmp, si, "F.rhoD", &fs.rho_d, &wf4);
            cmp_vec_f64(&mut cmp, si, "F.rhoG", &fs.rho_g, &wf5);
            cmp_vec_f64(&mut cmp, si, "F.rhoL", &fs.rho_l, &wf6);
            if fs.wet != wf7 {
                let idx: Vec<usize> = fs.wet.iter().zip(wf7.iter()).enumerate()
                    .filter(|(_, (a, b))| a != b).map(|(i, _)| i).collect();
                cmp.fail(si, format!("F.wet mismatch at {idx:?}"));
            }
            if fs.void_ != wf8 {
                cmp.fail(si, "F.void mismatch".to_string());
            }
            cmp_vec_f64(&mut cmp, si, "F.mu", &fs.mu, &wf9);
            cmp_vec_f64(&mut cmp, si, "F.lp", &fs.lp, &wf10);
            cmp_vec_f64(&mut cmp, si, "F.lh", &fs.lh, &wf11);
            cmp_vec_f64(&mut cmp, si, "F.lm", &fs.lm, &wf12);
            let mm = &st.solve_carry.memo;
            cmp_vec_f64(&mut cmp, si, "memo.kp", &mm.kp, &wm0);
            cmp_vec_f64(&mut cmp, si, "memo.kh", &mm.kh, &wm1);
            cmp_vec_f64(&mut cmp, si, "memo.km", &mm.km, &wm2);
            cmp_vec_f64(&mut cmp, si, "memo.p0", &mm.p0, &wm3);
            cmp_vec_f64(&mut cmp, si, "memo.cc", &mm.cc, &wm4);
            cmp_vec_f64(&mut cmp, si, "warr", &st.solve_carry.warr, &wwarr);
            // LOG slice + warns + ctl out/f + div set
            let got_log: Vec<(u8, u32)> =
                st.log[log_before.min(st.log.len())..].iter().map(|e| (e.sev, e.code)).collect();
            if got_log != want_log {
                cmp.fail(si, format!("events {:?} vs {:?}", got_log, want_log));
            }
            // warns + div + ctl out/f
            if r.warns != want_warns {
                cmp.fail(si, format!("warns {} vs {}", r.warns, want_warns));
            }
            let mut got_div = r.div_got.clone();
            got_div.sort();
            let mut want_divs = want_div.clone();
            want_divs.sort();
            if got_div != want_divs {
                cmp.fail(si, format!("div {:?} vs {:?}", got_div, want_divs));
            }
            cmp_vec_f64(&mut cmp, si, "ctl.out", &r.ctl_out, &want_out);
            cmp_vec_f64(&mut cmp, si, "ctl.f", &r.ctl_f, &want_f);
            if std::env::var("PROBE_DEBUG").is_ok() && pi == 0 && si == 0 {
                eprintln!("ctlout21 rep={} want={}", r.ctl_out.get(21).copied().unwrap_or(f64::NAN), want_out.get(21).copied().unwrap_or(f64::NAN));
            }
            if cmp.fails != f0 {
                println!("preset {pi} sample {si}: nfail={}", cmp.fails - f0);
            } else if std::env::var("PROBE_DEBUG").is_ok() {
                eprintln!("preset {pi} sample {si}: ok worst={:.3e} @ {}", cmp.worst, cmp.worst_at);
            }
            let _ = pi;
        }
    }
    println!(
        "samples={n_samples} worst-rel={:.2e} @ {} FAILURES={}",
        cmp.worst, cmp.worst_at, cmp.fails
    );
}
