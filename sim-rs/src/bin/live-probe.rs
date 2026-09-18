//! Live-derivation audit: which per-tick Sample fields are tick-constant
//! across a step-gate dump (frozen at ingest) vs live (ported readers).
//! With a freeze (argv[2], the gate's freeze.bin), also derives
//! live act assembly per tick and compares against the dumped sample.
#[path = "shared/probe_common.rs"]
mod common;
use common::read_freezes;
use sim_rs::ingest::*;
use sim_rs::ctl::{Act, Sample};
use sim_rs::live;
use sim_rs::step::{RoomTail, StepTick, step_replay};
use std::collections::HashSet;

fn bits_eq(a: f64, b: f64) -> bool {
    a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan())
}

fn audit_sample(base: &Sample, t: &Sample, vary: &mut HashSet<String>) {
    let mut v = |f: &str| { vary.insert(f.to_string()); };
    if t.dt.to_bits() != base.dt.to_bits() { v("dt"); }
    if t.live != base.live { v("live"); }
    if t.blocks.len() != base.blocks.len() { v("nblocks"); return; }
    for (i, (a, b)) in base.blocks.iter().zip(t.blocks.iter()).enumerate() {
        if a.mode != b.mode { v(&format!("blk[{i}].mode")); }
        if a.on != b.on { v("blk.on"); }
        if a.inputs != b.inputs { v("blk.inputs"); }
        if a.knob.iter().zip(b.knob.iter()).any(|(x, y)| !bits_eq(*x, *y)) { v("blk.knob"); }
        if a.nullmask != b.nullmask { v("blk.nullmask"); }
        if a.math_op != b.math_op { v("blk.math_op"); }
        if a.sel_op != b.sel_op { v("blk.sel_op"); }
        if a.cmp_op != b.cmp_op { v("blk.cmp_op"); }
        if !bits_eq(a.src_val, b.src_val) { v("blk.src_val"); }
        if a.sink_kind != b.sink_kind { v("blk.sink_kind"); }
        if a.sink_arg != b.sink_arg { v("blk.sink_arg"); }
        if a.dead != b.dead { v("blk.dead"); }
        if a.blame != b.blame { v("blk.blame"); }
    }
    if t.order != base.order { v("order"); }
    if t.out_pre.len() != base.out_pre.len()
        || t.out_pre.iter().zip(base.out_pre.iter()).any(|(a, b)| !bits_eq(*a, *b)) { v("out_pre"); }
    if t.f_pre.len() != base.f_pre.len()
        || t.f_pre.iter().zip(base.f_pre.iter()).any(|(a, b)| !bits_eq(*a, *b)) { v("f_pre"); }
    let (a, b) = (&base.act, &t.act);
    if !bits_eq(a.ar_lo, b.ar_lo) { v("act.ar_lo"); }
    if !bits_eq(a.ar_hi, b.ar_hi) { v("act.ar_hi"); }
    if !bits_eq(a.load_max, b.load_max) { v("act.load_max"); }
    if !bits_eq(a.rps_lag, b.rps_lag) { v("act.rps_lag"); }
    if !bits_eq(a.p_rated, b.p_rated) { v("act.p_rated"); }
    if !bits_eq(a.load, b.load) { v("act.load"); }
    if !bits_eq(a.load_dem, b.load_dem) { v("act.load_dem"); }
    if !bits_eq(a.boron_dem, b.boron_dem) { v("act.boron_dem"); }
    if a.rb_hot != b.rb_hot { v("act.rb_hot"); }
    if a.freg != b.freg { v("act.freg"); }
    if a.freg_exist != b.freg_exist { v("act.freg_exist"); }
    if a.flow != b.flow { v("act.flow"); }
    if a.flow_exist != b.flow_exist { v("act.flow_exist"); }
    if a.valve != b.valve { v("act.valve"); }
    if a.valve_exist != b.valve_exist { v("act.valve_exist"); }
    if a.tank != b.tank { v("act.tank"); }
    if a.tank_exist != b.tank_exist { v("act.tank_exist"); }
    if a.relief.len() != b.relief.len() { v("act.relief.len"); }
    for (x, y) in a.relief.iter().zip(b.relief.iter()) {
        if x.exist != y.exist || x.open != y.open || x.auto != y.auto
            || x.stuck != y.stuck || x.arm != y.arm || x.spring != y.spring { v("act.relief"); break; }
    }
    if a.cores.len() != b.cores.len() { v("act.cores.len"); }
    for (x, y) in a.cores.iter().zip(b.cores.iter()) {
        if !bits_eq(x.rod_dem, y.rod_dem) || x.rod_zdem != y.rod_zdem
            || x.rod_band != y.rod_band || x.split != y.split || x.regang != y.regang
            || x.bank_auto != y.bank_auto || x.rod_jam != y.rod_jam
            || x.scrammed != y.scrammed || !bits_eq(x.rps_hot, y.rps_hot)
            || x.rps_near != y.rps_near || x.trip != y.trip
            || !bits_eq(x.rated, y.rated) || !bits_eq(x.rod_rate, y.rod_rate)
            || x.pin_hot != y.pin_hot || x.dmg_rod != y.dmg_rod { v("act.cores"); break; }
    }
}

fn bad(fails: &mut u32, si: usize, f: &str) {
    *fails += 1;
    if *fails < 15 {
        println!("sample {si}: act.{f} mismatch");
    }
}

fn feq(x: f64, y: f64) -> bool {
    x.to_bits() == y.to_bits() || (x.is_nan() && y.is_nan())
}

fn cmp_act(si: usize, a: &Act, b: &Act, fails: &mut u32) {
    if !feq(a.ar_lo, b.ar_lo) { bad(fails, si, &format!("ar_lo {} vs {}", a.ar_lo, b.ar_lo)); }
    if !feq(a.ar_hi, b.ar_hi) { bad(fails, si, &format!("ar_hi {} vs {}", a.ar_hi, b.ar_hi)); }
    if !feq(a.load_max, b.load_max) { bad(fails, si, &format!("load_max {} vs {}", a.load_max, b.load_max)); }
    if !feq(a.rps_lag, b.rps_lag) { bad(fails, si, &format!("rps_lag {} vs {}", a.rps_lag, b.rps_lag)); }
    if !feq(a.p_rated, b.p_rated) { bad(fails, si, &format!("p_rated {} vs {}", a.p_rated, b.p_rated)); }
    if !feq(a.load, b.load) { bad(fails, si, &format!("load {} vs {}", a.load, b.load)); }
    if !feq(a.load_dem, b.load_dem) { bad(fails, si, &format!("load_dem {} vs {}", a.load_dem, b.load_dem)); }
    if !feq(a.boron_dem, b.boron_dem) { bad(fails, si, &format!("boron_dem {} vs {}", a.boron_dem, b.boron_dem)); }
    if a.rb_hot != b.rb_hot { bad(fails, si, "rb_hot"); }
    let vf = |x: &[f64], y: &[f64]| -> bool {
        x.len() == y.len() && x.iter().zip(y.iter()).all(|(p, q)| feq(*p, *q))
    };
    if !vf(&a.freg, &b.freg) { bad(fails, si, "freg"); }
    if a.freg_exist != b.freg_exist { bad(fails, si, "freg_exist"); }
    if !vf(&a.flow, &b.flow) {
        let lanes: Vec<String> = a.flow.iter().zip(b.flow.iter()).enumerate()
            .filter(|(_, (p, q))| !feq(**p, **q))
            .take(4).map(|(i, (p, q))| format!("{i}:{p}>{q}")).collect();
        bad(fails, si, &format!("flow {lanes:?}"));
    }
    if a.flow_exist != b.flow_exist { bad(fails, si, "flow_exist"); }
    if !vf(&a.valve, &b.valve) { bad(fails, si, "valve"); }
    if a.valve_exist != b.valve_exist { bad(fails, si, "valve_exist"); }
    if a.tank != b.tank { bad(fails, si, "tank"); }
    if a.tank_exist != b.tank_exist { bad(fails, si, "tank_exist"); }
    if a.relief.len() != b.relief.len() {
        bad(fails, si, "relief.len");
    } else {
        for (ri, (x, y)) in a.relief.iter().zip(b.relief.iter()).enumerate() {
            if x.exist != y.exist { bad(fails, si, &format!("relief[{ri}].exist")); }
            if x.open != y.open { bad(fails, si, &format!("relief[{ri}].open")); }
            if x.auto != y.auto { bad(fails, si, &format!("relief[{ri}].auto")); }
            if x.stuck != y.stuck { bad(fails, si, &format!("relief[{ri}].stuck")); }
            if x.arm != y.arm { bad(fails, si, &format!("relief[{ri}].arm")); }
            if x.spring != y.spring { bad(fails, si, &format!("relief[{ri}].spring")); }
        }
    }
    if a.cores.len() != b.cores.len() {
        bad(fails, si, "cores.len");
    } else {
        for (ci, (x, y)) in a.cores.iter().zip(b.cores.iter()).enumerate() {
            if !feq(x.rod_dem, y.rod_dem) { bad(fails, si, &format!("cores[{ci}].rod_dem {} vs {}", x.rod_dem, y.rod_dem)); }
            if x.rod_zdem != y.rod_zdem { bad(fails, si, &format!("cores[{ci}].rod_zdem")); }
            if x.rod_band != y.rod_band { bad(fails, si, &format!("cores[{ci}].rod_band")); }
            if x.split != y.split { bad(fails, si, &format!("cores[{ci}].split")); }
            if x.regang != y.regang { bad(fails, si, &format!("cores[{ci}].regang")); }
            if x.bank_auto != y.bank_auto { bad(fails, si, &format!("cores[{ci}].bank_auto")); }
            if x.rod_jam != y.rod_jam { bad(fails, si, &format!("cores[{ci}].rod_jam")); }
            if x.scrammed != y.scrammed { bad(fails, si, &format!("cores[{ci}].scrammed")); }
            if !feq(x.rps_hot, y.rps_hot) { bad(fails, si, &format!("cores[{ci}].rps_hot {} vs {}", x.rps_hot, y.rps_hot)); }
            if x.rps_near != y.rps_near { bad(fails, si, &format!("cores[{ci}].rps_near")); }
            if x.trip != y.trip { bad(fails, si, &format!("cores[{ci}].trip")); }
            if !feq(x.rated, y.rated) { bad(fails, si, &format!("cores[{ci}].rated")); }
            if !feq(x.rod_rate, y.rod_rate) { bad(fails, si, &format!("cores[{ci}].rod_rate")); }
            if x.pin_hot != y.pin_hot { bad(fails, si, &format!("cores[{ci}].pin_hot")); }
            if x.dmg_rod != y.dmg_rod { bad(fails, si, &format!("cores[{ci}].dmg_rod")); }
        }
    }
}


fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let tbl: Option<Vec<live::FrozenTable>> = (a.len() > 2).then(|| read_freezes(&a[2]).into_iter().map(|f| f.ctl_table).collect());
    let tbl_idx: usize = if a.len() > 3 { a[3].parse().unwrap_or(0) } else { 0 };
    let mut c = Cur { b: &bytes, o: 0, trace: false };
    let np = c.u32() as usize;
    let ver = c.u32();
    assert!(format_ok(ver), "dump format {ver}");
    for pi in 0..np {
        let preset = read_preset(&mut c, ver);
        let ncore = preset.core_ids.len();
        let nticks = c.u32() as usize;
        println!("== preset {pi} nticks={nticks}");
        let mut vary = HashSet::new();
        let mut key_vary = HashSet::new();
        let mut base: Option<Sample> = None;
        let mut base_keys = String::new();
        let mut src_seen: Vec<Option<u64>> = vec![];
        let mut src_vary: HashSet<String> = HashSet::new();
        let mut st = preset.st;
        let mut frozen: Option<live::CtlFrozen> = None;
        let mut ctl_live_st: Option<live::CtlLive> = None;
        let mut act_fails = 0u32;
        let mut eval_fails = 0u32;
        let mut prev_act: Option<Act> = None;
        let mut last_live = true;
        let tp: Option<&live::FrozenTable> = tbl.as_ref().and_then(|v| v.get(tbl_idx + pi));
        for ti in 0..nticks {
            let t = read_tick(&mut c, &preset.meta, ncore, pi, ti);
            if ti == 0 {
                src_seen = t.sample.blocks.iter().map(|_| None).collect();
            }
            let ks = format!("{:?}{:?}{:?}{:?}{:?}{:?}", t.ctl_keys.freg_keys, t.ctl_keys.flow_keys, t.ctl_keys.valve_keys, t.ctl_keys.tank_keys, t.ctl_keys.relief_keys, t.ctl_keys.core_ids);
            if src_seen.len() != t.sample.blocks.len() {
                src_vary.insert("nblocks-changed".to_string());
            } else {
                for (i, blk) in t.sample.blocks.iter().enumerate() {
                    if blk.mode != 0 {
                        continue;
                    }
                    let bits = if blk.src_val.is_nan() { u64::MAX } else { blk.src_val.to_bits() };
                    match src_seen[i] {
                        None => src_seen[i] = Some(bits),
                        Some(v) => { if v != bits { src_vary.insert(i.to_string()); } }
                    }
                }
            }
            match base {
                None => { base = Some(t.sample.clone()); base_keys = ks; }
                Some(ref b) => {
                    audit_sample(b, &t.sample, &mut vary);
                    if ks != base_keys { key_vary.insert("ctl_keys"); }
                }
            }
            if let Some(tp) = tp {
                if ti == 0 || t.sample.live != last_live {
                    println!("preset {pi} tick {ti}: live={}", t.sample.live);
                    last_live = t.sample.live;
                }
                if frozen.is_none() {
                    if tp.ids.len() != t.sample.blocks.len() {
                        println!("preset {pi}: table/sample block count mismatch {} vs {}", tp.ids.len(), t.sample.blocks.len());
                    }
                    let (fr, lv) = live::freeze_ctl(t.sample.clone(), tp, &t.ctl_keys);
                    frozen = Some(fr);
                    ctl_live_st = Some(lv);
                }
                if let Some(fr) = frozen.as_ref() {
                    let rh: Vec<f64> = t.sample.act.cores.iter().map(|c| c.rps_hot).collect();
                    let got = live::assemble_act(&preset.meta, &st, fr, &rh);
                    cmp_act(ti, &got, &t.sample.act, &mut act_fails);
                    if let Some(pa) = prev_act.as_ref() {
                        for (ci, (x, y)) in pa.cores.iter().zip(t.sample.act.cores.iter()).enumerate() {
                            if x.scrammed != y.scrammed { println!("sample {ti}: post cores[{ci}].scrammed"); eval_fails += 1; }
                            if x.trip != y.trip { println!("sample {ti}: post cores[{ci}].trip"); eval_fails += 1; }
                            if x.rps_hot.to_bits() != y.rps_hot.to_bits() && !(x.rps_hot.is_nan() && y.rps_hot.is_nan()) { println!("sample {ti}: post cores[{ci}].rps_hot"); eval_fails += 1; }
                        }
                        if pa.rb_hot != t.sample.act.rb_hot { println!("sample {ti}: post rb_hot"); eval_fails += 1; }
                    }
                    if let Some(lv) = ctl_live_st.as_mut() {
                        let rep = live::live_ctl(&preset.meta, &st, fr, lv);
                        if ti == 0 {
                            println!("preset {pi}: blklen st={} f={} sample={}", st.blk_out.len(), st.blk_f.len(), t.sample.blocks.len());
                            if t.sample.blocks.len() > 44 {
                                let b44 = &t.sample.blocks[44];
                                println!("preset {pi}: b44 inputs={:?} knob={:?} nullmask={} in0out={:?}", b44.inputs, b44.knob, b44.nullmask, b44.inputs.first().and_then(|&s| if s >= 0 { t.want_out.get(s as usize).copied() } else { None }));
                            }
                        }
                        let mut worst = 0.0f64;
                        let mut worst_i = 0usize;
                        let mut worst_pair = (0.0f64, 0.0f64);
                        for (i, (a, b)) in rep.out.iter().zip(t.want_out.iter()).enumerate() {
                            let r = (a - b).abs() / (a.abs() + b.abs() + 1e-30);
                            if r > worst {
                                worst = r;
                                worst_i = i;
                                worst_pair = (*a, *b);
                            }
                        }
                        if worst > 1e-6 {
                            println!("sample {ti}: eval out worst={worst:.3e} @ {worst_i} {} vs {}", worst_pair.0, worst_pair.1);
                            eval_fails += 1;
                        }
                        if rep.f.len() != t.want_f.len()
                            || rep.f.iter().zip(t.want_f.iter()).enumerate().any(|(_, (a, b))| a.to_bits() != b.to_bits() && !(a.is_nan() && b.is_nan()))
                        {
                            let lanes: Vec<String> = rep.f.iter().zip(t.want_f.iter()).enumerate()
                                .filter(|(_, (a, b))| a.to_bits() != b.to_bits() && !((*a).is_nan() && (*b).is_nan()))
                                .take(6).map(|(i, (a, b))| format!("{i}:{a}>{b}")).collect();
                            println!("sample {ti}: eval f mismatch {} vs {} {lanes:?}", rep.f.len(), t.want_f.len());
                            eval_fails += 1;
                        }
                        prev_act = Some(rep.act);
                    }
                    let lf = live::ctl_live(&preset.meta, &st, fr);
                    if lf != t.sample.live {
                        println!("sample {ti}: live {lf} vs {}", t.sample.live);
                        act_fails += 1;
                    }
                    if fr.sig.len() == t.sample.blocks.len() {
                        for (i, b) in t.sample.blocks.iter().enumerate() {
                            if b.mode == sim_rs::ctl::MODE_SOURCE {
                                // Dark cabinet holds every output: dumped src
                                // is pre-pass blkOutV, not a live read.
                                if !t.sample.live {
                                    continue;
                                }
                                let v = live::sig_read(&preset.meta, &st, fr, i);
                                let w = b.src_val;
                                let exact = v.to_bits() == w.to_bits() || (v.is_nan() && w.is_nan());
                                if !exact {
                                    let rel = (v - w).abs() / (v.abs() + w.abs() + 1e-30);
                                    if rel > 1e-6 || v.is_nan() != w.is_nan() {
                                        let post = t.want_core.get(&fr.arg[i]).map(|cs| cs.heat);
                                        println!("sample {ti}: src[{i}] {}/{ } on={} {v} vs {w} post={post:?}", fr.sig[i], fr.arg[i], b.on);
                                        act_fails += 1;
                                    }
                                }
                            }
                            if b.mode == sim_rs::ctl::MODE_SINK {
                                let d = live::sink_dead(&preset.meta, &st, fr, b.sink_kind, &fr.arg[i]);
                                if d != b.dead {
                                    println!("sample {ti}: dead[{i}] {d} vs {}", b.dead);
                                    act_fails += 1;
                                }
                            }
                        }
                    }
                }
            }
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
            if tick.ctl.as_ref().unwrap().out_pre.len() == st.blk_out.len() {
            } else if st.blk_out.is_empty() && st.blk_f.is_empty() {
                let s = tick.ctl.as_ref().unwrap();
                st.blk_out = s.out_pre.clone();
                st.blk_f = s.f_pre.clone();
            }
            st.tick += 1;
            step_replay(&preset.meta, &mut st, &mut tick);
        }
        let mut v: Vec<&String> = vary.iter().collect();
        v.sort();
        let mut k: Vec<&&str> = key_vary.iter().collect();
        k.sort();
        let mut s: Vec<&String> = src_vary.iter().collect();
        s.sort();
        println!("preset {pi}: nticks={nticks} varying={v:?} keys={k:?} varying_src_blocks={s:?} act_fails={act_fails} eval_fails={eval_fails}");
    }
}
