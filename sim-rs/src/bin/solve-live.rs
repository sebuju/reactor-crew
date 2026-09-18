//! solve-live verify: run the live solve phase per tick (lanes, fallbacks,
//! field, pieces, assembly) and compare against the dumped-tail replay path
//! (same carried in, bit-exact `SolveOut` + carried deltas) plus gate dumps
//! (field, pieces, pField, warr). Carried state evolves through the LIVE
//! path, engine-style; the replay path runs on clones.
//! Usage: solve-live <dump.bin> <freeze.bin> [dbgfile.txt]
#[path = "shared/probe_common.rs"]
mod common;
use common::{parse_pcdec, read_freezes, replay_postpass};
use sim_rs::ingest::*;
use sim_rs::{netlive, solvelive};
use std::collections::HashMap;

fn feq(a: f64, b: f64) -> bool {
    a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan())
}

fn cmp_f64a(si: usize, what: &str, a: &[f64], b: &[f64], fails: &mut u32) {
    if a.len() != b.len() {
        *fails += 1;
        if *fails < 100 {
            println!("sample {si}: {what} len {} vs {}", a.len(), b.len());
        }
        return;
    }
    for (i, (x, y)) in a.iter().zip(b.iter()).enumerate() {
        if !feq(*x, *y) {
            *fails += 1;
            if *fails < 100 {
                println!("sample {si}: {what}[{i}] {x} vs {y}");
            }
            return;
        }
    }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let freezes = read_freezes(&a[2]);
    let pcdec = if a.len() > 3 {
        parse_pcdec(&std::fs::read_to_string(&a[3]).unwrap())
    } else {
        HashMap::new()
    };
    let mut c = Cur { b: &bytes, o: 0, trace: false };
    let np = c.u32() as usize;
    let ver = c.u32();
    assert!(ver == 1 || ver == 2, "format v1|v2");
    let mut fails = 0u32;
    let mut total = 0u32;
    let mut fails_by_tick: HashMap<(usize, usize), u32> = HashMap::new();
    for ppi in 0..np {
        let preset = read_preset(&mut c, ppi, ver);
        let ncore = preset.core_ids.len();
        let nticks = c.u32() as usize;
        let fr = &freezes[ppi].edge;
        assert_eq!(fr.edges.len(), preset.meta.solve.ne, "preset {ppi} ne");
        if ppi == 0 {
            eprintln!("dbg suggest_n={} curves_n={} setp_len={} curveof_max={} ncirc_nodes={}",
                fr.suggest.len(),
                preset.meta.sec_curves.curves.len(),
                preset.meta.sec_curves.set_p.len(),
                preset.meta.solve.curve_of.iter().max().copied().unwrap_or(9999),
                preset.meta.solve.curve_of.len());
        }
        println!("== preset {ppi} nticks={nticks} ne={}", fr.edges.len());
        let mut pre_sec = preset.st.sec.clone();
        let mut pre_ev = preset.st.events.clone();
        let mut pre_core = preset.st.core.clone();
        let mut pre_warr = preset.st.solve_carry.warr.clone();
        let mut pre_bags: HashMap<String, sim_rs::step::NodeBag> = [
            ("mBy", preset.st.m_by.clone()), ("hBy", preset.st.h_by.clone()),
            ("pBy", preset.st.p_by.clone()), ("bBy", preset.st.b_by.clone()),
            ("h2By", preset.st.h2_by.clone()), ("metalT", preset.st.metal.clone()),
        ].into_iter().map(|(k, v)| (k.to_string(), v)).collect();
        let mut carried = preset.st.solve_carry.clone();
        // Seed the piece cache from the S0 snapshot (commission pc) keyed by
        // the commission pcSig the freeze carries, as the engine seeds it.
        let mut memo = netlive::PiecesMemo {
            of: preset.st.solve_carry.pc_of.clone(),
            n: preset.st.solve_carry.pc_npc,
            live: preset.st.solve_carry.pc_live.clone(),
            sig: freezes[ppi].tail.pc_sig.clone(),
            valid: true,
        };
        let mut shut_warned = false;
        for ti in 0..nticks {
            let t = read_tick(&mut c, &preset.meta, ncore, ppi, ti);
            total += 1;
            let f0 = fails;
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
            let curves = solvelive::patch_curves(&meta.sec_curves, &fr.suggest);
            // fallbacks + pool vs dumped tails.
            let (fb_p, fb_h, pool) = solvelive::fallbacks_live(meta, &curves, &st);
            cmp_f64a(ti, "fb_p", &fb_p, &t.solve_tail.fallback_p, &mut fails);
            cmp_f64a(ti, "fb_h", &fb_h, &t.solve_tail.fallback_h, &mut fails);
            if pool.len() != t.solve_tail.pool_lvl.len() {
                fails += 1;
                if fails < 100 {
                    println!("sample {ti}: pool len {} vs {}", pool.len(), t.solve_tail.pool_lvl.len());
                }
            } else {
                for (i, (a, b)) in pool.iter().zip(t.solve_tail.pool_lvl.iter()).enumerate() {
                    let ok = match (a, b) {
                        (Some(x), Some(y)) => feq(*x, *y),
                        (None, None) => true,
                        _ => false,
                    };
                    if !ok {
                        fails += 1;
                        if fails < 100 {
                            println!("sample {ti}: pool[{i}] {a:?} vs {b:?}");
                        }
                        break;
                    }
                }
            }
            // lanes vs dumped (q39 scaffolding skipped; q-probe owns detail).
            let (lq, lgv) = solvelive::lanes_live(meta, &curves, fr, &st, &pre_warr, t.sec_tail.exh_open, false);
            for e in 0..meta.solve.ne {
                let q = &t.solve_tail.edge_q[e];
                for lane in 0..45 {
                    if lane == 39 {
                        continue;
                    }
                    if !feq(lq[e][lane], q[lane]) {
                        fails += 1;
                        if fails < 12 {
                            println!("sample {ti}: lane e{e}q{lane} {} vs {}", lq[e][lane], q[lane]);
                        }
                        break;
                    }
                }
                let gv = &t.solve_tail.edge_gates[e];
                if lgv[e].len() != gv.len()
                    || lgv[e].iter().zip(gv.iter()).any(|(a, b)| !feq(*a, *b))
                {
                    fails += 1;
                    if fails < 12 {
                        println!("sample {ti}: gates e{e} {:?} vs {gv:?}", lgv[e]);
                    }
                }
            }
            // twice-run: replay path on a clone, live path evolving carried.
            let mut carried_r = carried.clone();
            let sin = sim_rs::step::SolveIn::from_tail(&t.solve_tail);
            let level = pre_sec.f64s.get("P").copied().unwrap_or(meta.sec.p0);
            let mut warns_r = 0u32;
            let out_r = sim_rs::step::solve_tick(
                &meta.solve, &meta.solve.curves, &mut carried_r,
                &st.p_by.v, &st.p_by.has, &st.m_by.v, &st.m_by.has,
                &st.h_by.v, &st.h_by.has, level, &sin, &mut warns_r,
            );
            let mut shut: Vec<String> = st.events.port_shut.iter().cloned().collect();
            shut.sort();
            if !shut.is_empty() && !shut_warned {
                println!("preset {ppi}: NONEMPTY shut {shut:?} (sorted-order caveat)");
                shut_warned = true;
            }
            let mut warns_l = 0u32;
            let pre_sig = memo.sig.clone();
            let (out_l, sig_l, reuse_l) = solvelive::solve_live(
                meta, fr, &st, &mut carried, t.sec_tail.exh_open, false,
                &t.solve_tail, &mut warns_l, &mut memo, &shut,
            );
            if let Some(d) = pcdec.get(&(ppi, ti)) {
                if sig_l != d.sig_solve {
                    fails += 1;
                    if fails < 100 {
                        println!("sample {ti}: sig {sig_l} vs {}", d.sig_solve);
                    }
                }
                if reuse_l != d.reuse {
                    fails += 1;
                    if fails < 100 {
                        let di = pre_sig.chars().zip(sig_l.chars()).position(|(a, b)| a != b);
                        let dg = d.sig_solve.chars().zip(sig_l.chars()).position(|(a, b)| a != b);
                        println!("sample {ti}: reuse mine={reuse_l} gate={} memosig_diff_at={di:?} gatesig_diff_at={dg:?}",
                            d.reuse);
                        println!("  memosig={pre_sig}");
                        println!("  mysig  ={sig_l}");
                        if let Some(i) = di {
                            println!("  memoctx={:?} myctx={:?}",
                                pre_sig.chars().skip(i.saturating_sub(20)).take(45).collect::<String>(),
                                sig_l.chars().skip(i.saturating_sub(20)).take(45).collect::<String>());
                        }
                    }
                }
            }
            // SolveOut exact compare.
            cmp_f64a(ti, "p_field", &out_l.p_field_v, &out_r.p_field_v, &mut fails);
            if out_l.p_field_has != out_r.p_field_has {
                fails += 1;
                if fails < 100 {
                    println!("sample {ti}: p_field_has mismatch");
                }
            }
            cmp_f64a(ti, "run_flow", &out_l.run_flow_v, &out_r.run_flow_v, &mut fails);
            cmp_f64a(ti, "edge_kg", &out_l.edge_kg, &out_r.edge_kg, &mut fails);
            cmp_f64a(ti, "by", &out_l.by_v, &out_r.by_v, &mut fails);
            cmp_f64a(ti, "sgtr", &out_l.sgtr_v, &out_r.sgtr_v, &mut fails);
            cmp_f64a(ti, "core_kg", &out_l.core_kg_v, &out_r.core_kg_v, &mut fails);
            for (i, (a, b)) in out_l.sc_v.iter().zip(out_r.sc_v.iter()).enumerate() {
                if !feq(*a, *b) {
                    fails += 1;
                    if fails < 100 {
                        println!("sample {ti}: sc[{i}] {a} vs {b}");
                    }
                    break;
                }
            }
            for (i, (a, b)) in out_l.leg_sc.iter().zip(out_r.leg_sc.iter()).enumerate() {
                if !feq(*a, *b) {
                    fails += 1;
                    if fails < 100 {
                        println!("sample {ti}: leg_sc[{i}] {a} vs {b}");
                    }
                    break;
                }
            }
            for (k, a, b) in [("core_tot", out_l.core_tot, out_r.core_tot), ("pump_k", out_l.pump_k, out_r.pump_k), ("heat", out_l.heat, out_r.heat), ("nat", out_l.nat_val, out_r.nat_val)]
            {
                if !feq(a, b) {
                    fails += 1;
                    if fails < 100 {
                        println!("sample {ti}: {k} {a} vs {b}");
                    }
                }
            }
            if out_l.by_loop_leg != out_r.by_loop_leg {
                fails += 1;
                if fails < 100 {
                    println!("sample {ti}: by_loop_leg mismatch");
                }
            }
            if out_l.div_got != out_r.div_got {
                fails += 1;
                if fails < 100 {
                    println!("sample {ti}: div_got mismatch");
                }
            }
            if warns_l != warns_r {
                fails += 1;
                if fails < 100 {
                    println!("sample {ti}: warns {warns_l} vs {warns_r}");
                }
            }
            // carried deltas exact compare (fs/warr/choke/pc/memo/fix_v/div).
            let (fa, fb) = (&carried, &carried_r);
            for (nm, a, b) in [
                ("fs.p", &fa.fs.p, &fb.fs.p), ("fs.rho", &fa.fs.rho, &fb.fs.rho),
                ("fs.x", &fa.fs.x, &fb.fs.x), ("fs.b", &fa.fs.b, &fb.fs.b),
                ("fs.rho_d", &fa.fs.rho_d, &fb.fs.rho_d), ("fs.rho_g", &fa.fs.rho_g, &fb.fs.rho_g),
                ("fs.rho_l", &fa.fs.rho_l, &fb.fs.rho_l), ("fs.mu", &fa.fs.mu, &fb.fs.mu),
                ("fs.lp", &fa.fs.lp, &fb.fs.lp), ("fs.lh", &fa.fs.lh, &fb.fs.lh),
                ("fs.lm", &fa.fs.lm, &fb.fs.lm), ("warr", &fa.warr, &fb.warr),
                ("fix_v", &fa.fix_v, &fb.fix_v),
            ] {
                if a.len() != b.len() || a.iter().zip(b.iter()).any(|(x, y)| !feq(*x, *y)) {
                    fails += 1;
                    if fails < 100 {
                        println!("sample {ti}: carried.{nm} mismatch");
                    }
                }
            }
            for (nm, a, b) in [("wet", &fa.fs.wet, &fb.fs.wet), ("void", &fa.fs.void_, &fb.fs.void_), ("pc_live", &fa.pc_live, &fb.pc_live)] {
                if a != b {
                    fails += 1;
                    if fails < 100 {
                        println!("sample {ti}: carried.{nm} mismatch");
                    }
                }
            }
            if fa.pc_of != fb.pc_of || fa.pc_npc != fb.pc_npc || fa.choke != fb.choke || fa.div_sig != fb.div_sig {
                fails += 1;
                if fails < 100 {
                    let fi = fa.pc_of.iter().zip(fb.pc_of.iter()).position(|(a, b)| a != b);
                    println!("sample {ti}: carried pc_of:{fi:?} npc:{}vs{} choke:{}vs{} div:{:?}vs{:?}",
                        fa.pc_npc, fb.pc_npc, fa.choke, fb.choke, fa.div_sig, fb.div_sig);
                }
            }
            for (nm, a, b) in [("memo.kp", &fa.memo.kp, &fb.memo.kp), ("memo.kh", &fa.memo.kh, &fb.memo.kh), ("memo.km", &fa.memo.km, &fb.memo.km), ("memo.p0", &fa.memo.p0, &fb.memo.p0), ("memo.cc", &fa.memo.cc, &fb.memo.cc)] {
                if a.len() != b.len() || a.iter().zip(b.iter()).any(|(x, y)| !feq(*x, *y)) {
                    fails += 1;
                    if fails < 100 {
                        println!("sample {ti}: carried.{nm} mismatch");
                    }
                }
            }
            // dumps smoke: live outputs vs gate truth.
            if let Some(want) = t.want_bags.get("pBy") {
                if out_l.p_field_v.len() != want.0.len()
                    || out_l.p_field_v.iter().zip(want.0.iter()).any(|(a, b)| !feq(*a, *b))
                {
                    fails += 1;
                    if fails < 100 {
                        println!("sample {ti}: pField vs dump mismatch");
                    }
                }
            }
            if carried.warr.len() != t.wwarr.len()
                || carried.warr.iter().zip(t.wwarr.iter()).any(|(a, b)| !feq(*a, *b))
            {
                fails += 1;
                if fails < 100 {
                    println!("sample {ti}: warr vs dump mismatch");
                }
            }
            // pieces vs dumped tails.
            if memo.of != t.solve_tail.pc_of || memo.n != t.solve_tail.pc_npc || memo.live != t.solve_tail.pc_live {
                fails += 1;
                if fails < 100 {
                    let fi = memo.of.iter().zip(t.solve_tail.pc_of.iter()).position(|(a, b)| a != b);
                    let li = memo.live.iter().zip(t.solve_tail.pc_live.iter()).position(|(a, b)| a != b);
                    println!("sample {ti}: pieces vs dump of:{fi:?} npc:{}vs{} live:{li:?}",
                        memo.n, t.solve_tail.pc_npc);
                }
            }
            // advance truth leaves (carried evolves through the LIVE path).
            pre_sec = t.want_sec;
            pre_ev = t.want_events;
            pre_core = t.want_core;
            pre_warr = t.wwarr.clone();
            for (name, (v, h)) in &t.want_bags {
                pre_bags.insert(name.clone(), sim_rs::step::NodeBag { v: v.clone(), has: h.clone() });
            }
            if fails != f0 {
                fails_by_tick.insert((ppi, ti), fails - f0);
            }
        }
    }
    println!("solve-live: ticks={total} fails={fails}");
    let mut fbt: Vec<((usize, usize), u32)> = fails_by_tick.into_iter().collect();
    fbt.sort();
    println!("  by_tick={fbt:?}");
    std::process::exit(if fails == 0 { 0 } else { 1 });
}
