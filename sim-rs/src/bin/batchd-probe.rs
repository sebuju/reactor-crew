//! Batch-D live transport-tail probe: replays full ticks with dumped tails
//! (exact, like step-probe) while pre_advect computes every transport-tail
//! input LIVE from replay state and diffs it against the dumped value.
//! Dev-only.
//! Usage: batchd-probe <dump.bin> <edge-frozen.json> <tail-frozen.json>
#[path = "shared/probe_common.rs"]
mod common;
use common::{parse_edge_frozen, parse_tail_frozen, to_lib_edge};
use sim_rs::frozen::TailFrozen;
use sim_rs::ingest::*;
use sim_rs::step::*;
use sim_rs::{edge, live, netlive, solvelive, transport};
use std::collections::HashMap;

/// Independently probed `h_turb`/`holdDampK` per preset, keyed by the
/// dumped `P.rated`: the derivations are checked against these, never fed
/// from them. (rated, h_turb, damp).
const XCHECK: &[(f64, f64, f64)] = &[
    (1197.007183329629, 2654.4797121870793, 1.0),
    (693.4782095854108, 2654.4797121870793, 1.0),
    (1056.3753790762514, 2754.0350416057386, 1.0),
    (984.7844381303881, 2148.4787792390393, 1.0),
    (963.919981085801, 2654.4797121870793, 1.0),
    (1037.1795680062369, 2654.480240931293, 1.0),
    (831.5277452941555, 2148.4787792390393, 1.0),
    (56.5167535882465, 2148.4787792390393, 1.0),
    (1386.9564191708216, 2654.4797121870793, 2.0),
];

struct Cmp {
    ok: u32,
    fail: u32,
    shown: u32,
    pi: usize,
    groups: HashMap<String, u64>,
}

impl Cmp {
    fn base(name: &str) -> String {
        name.split('[').next().unwrap_or(name).to_string()
    }
    fn f(&mut self, si: usize, name: &str, got: f64, want: f64) {
        if got == want || (got.is_nan() && want.is_nan()) {
            self.ok += 1;
        } else {
            self.fail += 1;
            *self.groups.entry(Self::base(name)).or_insert(0) += 1;
            if self.shown < 40 {
                println!("p{} tick {si}: LIVE-MISMATCH {name}: got={got} want={want}", self.pi);
                self.shown += 1;
            }
        }
    }
    fn b(&mut self, si: usize, name: &str, got: bool, want: bool) {
        if got == want {
            self.ok += 1;
        } else {
            self.fail += 1;
            *self.groups.entry(Self::base(name)).or_insert(0) += 1;
            if self.shown < 40 {
                println!("p{} tick {si}: LIVE-MISMATCH {name}: got={got} want={want}", self.pi);
                self.shown += 1;
            }
        }
    }
}

struct LiveHook<'a> {
    cmp: Cmp,
    si: usize,
    pi: usize,
    tick: &'a StepTick,
    tf: &'a TailFrozen,
    fr: &'a solvelive::EdgeFrozen,
    patched: sim_rs::sec::SecCurves,
    sugg: Vec<f64>,
    eff: f64,
    l_pzr_k: f64,
    boron0: f64,
    boron0_set: bool,
    /// Sec-owned turbWk diverges live (turbStep OWK NaN; sdig-blind in the
    /// step gate). JS tick-ti-pre value == dumped tick-(ti-1)-END value
    /// (only turbStep writes it, late). Substituted here to isolate the
    /// transport readers; reported as SEC-1.
    turb_wk_sub: Option<f64>,
    want_warr: &'a [f64],
    prev_core: &'a HashMap<String, sim_rs::core::CoreState>,
    prev_room: Option<&'a sim_rs::room::RoomState>,
}

fn prev_room_skin(prev: Option<&sim_rs::room::RoomState>, id: &str) -> Option<f64> {
    prev.and_then(|r| r.maps.get("skinQ").and_then(|m| m.get(id)))
}

impl<'a> StageHook for LiveHook<'a> {    fn pre_advect(&mut self, meta: &StepMeta, st: &StepState, sout: &SolveOut, tail: &TransTail) {
        let si = self.si;
        // Commission cross-checks (not gate fields): the frozen h_turb against
        // its probe, and against the derivation wherever a generator states a
        // design pressure to derive it from.
        let ht = self.tf.h_turb;
        let damp = transport::live_hold_damp_k(meta);
        let (_, ht_x, damp_x) = XCHECK.iter().find(|s| s.0 == meta.sec.rated).copied().unwrap_or((0.0, f64::NAN, f64::NAN));
        self.cmp.f(si, "x.hturb", ht, ht_x);
        if !meta.sec.sg_design_p.is_empty() {
            let sg_des = meta.sec.sg_design_p.iter().sum::<f64>() / meta.sec.sg_design_p.len() as f64;
            let derived = transport::live_h_turb(
                meta.sec.steam_rise, transport::live_cond_p_des(&self.patched.water), sg_des,
            );
            self.cmp.f(si, "x.hturb_derived", derived, ht);
        }
        self.cmp.f(si, "x.damp", damp, damp_x);
        // boron0 is a run constant: capture tick-0 live boron (S0 boron).
        if !self.boron0_set {
            self.boron0 = st.sec.f64s.get("boron").copied().unwrap_or(f64::NAN);
            self.boron0_set = true;
        }
        let n = meta.trans.n;
        // Solved run flow keyed by run (sout order == run_flow_keys).
        let keys = &self.tick.sec_tail.run_flow_keys;
        let mut run_flow = HashMap::new();
        for (k, key) in keys.iter().enumerate() {
            if let Some(&v) = sout.run_flow_v.get(k) {
                run_flow.insert(key.clone(), v);
            }
        }
        let exh = live::live_exh_open(st).unwrap_or(self.tick.sec_tail.exh_open);
        let cond_frac = live::live_cond_frac(meta, &self.patched, st);
        // 1. advectSrc + metal books off live state (metal settle on a clone).
        let mut mv = st.metal.v.clone();
        let mut mh = st.metal.has.clone();
        let ctx = transport::AdvectSrcCtx {
            meta,
            curves: &self.patched,
            st,
            dt: self.tick.dt,
            wet: &st.solve_carry.fs.wet,
            run_flow: &run_flow,
            exh_open: exh,
            cond_ua: &self.tf.cond_ua,
            cw_ref: &self.tf.cw_ref,
            cond_frac,
            suggest: &self.sugg,
            eff: self.eff,
            h_turb: ht,
            p_rise: transport::live_p_rise(meta.sec.p0),
            pzr_k: damp * self.l_pzr_k,
            turb_wk_override: self.turb_wk_sub,
        };
        let got = transport::live_advect_src(&ctx, &mut mv, &mut mh);
        if got.src.len() != tail.src.len() {
            self.cmp.fail += 1;
            println!("p tick {si}: LIVE-MISMATCH src.len: got={} want={}", got.src.len(), tail.src.len());
        } else {
            for (i, (&g, &w)) in got.src.iter().zip(tail.src.iter()).enumerate() {
                self.cmp.f(si, &format!("src[{i}]"), g, w);
            }
            if std::env::var("BATCHD_DEBUG").is_ok() {
                let bad: Vec<usize> = got.src.iter().zip(tail.src.iter()).enumerate()
                    .filter(|(_, (&a, &b))| a != b && !(a.is_nan() && b.is_nan())).map(|(i, _)| i).collect();
                for i in bad {
                    let nm = meta.sec.net_names.get(i).map(|s| s.as_str()).unwrap_or("?");
                    let skinmap = st.room.maps.get("skinQ").map(|m| m.keys.iter().zip(m.vals.iter()).map(|(k, v)| (k.clone(), *v)).collect::<Vec<_>>()).unwrap_or_default();
                    let hb = st.sec.heatbal.sg_q_by.keys.iter().zip(st.sec.heatbal.sg_q_by.vals.iter()).map(|(k, v)| (k.clone(), *v)).collect::<Vec<_>>();
                    // Upstream triangulation vs PREVIOUS tick END wants
                    // (tick-ti-pre state == tick-(ti-1)-END for these leaves).
                    let mut up = vec![];
                    for id in &meta.core_ids {
                        let cs = st.core.get(id.as_str());
                        up.push((format!("{id}.heat"), cs.map(|c| c.heat), self.prev_core.get(id).map(|c| c.heat)));
                        up.push((format!("{id}.fci"), cs.map(|c| c.fci), self.prev_core.get(id).map(|c| c.fci)));
                    }
                    let mut skins = vec![];
                    for id in meta.sec.sg_ids.iter().chain(meta.sec.ihx_ids.iter()).chain(meta.core_ids.iter()) {
                        skins.push((id.clone(),
                            st.room.maps.get("skinQ").and_then(|m| m.get(id)),
                            prev_room_skin(self.prev_room, id)));
                    }
                    let e = |v: Option<f64>| match v {
                        Some(x) => format!("{x:e}"),
                        None => "none".to_string(),
                    };
                    let ups: Vec<String> = up.iter().map(|(k, a, b)| format!("{k}:{}~{}", e(*a), e(*b))).collect();
                    let sks: Vec<String> = skins.iter().map(|(k, a, b)| format!("{k}:{}~{}", e(*a), e(*b))).collect();
                    println!("p{} tick {} src[{}] nm={}: got={:e}({:#x}) want={:e}({:#x}) up=[{}] skins=[{}] metal_qv={:e}",
                        self.pi, si, i, nm, got.src[i], got.src[i].to_bits(), tail.src[i], tail.src[i].to_bits(),
                        ups.join(" "), sks.join(" "),
                        got.metal_qv.get(i).copied().unwrap_or(f64::NAN));
                    let mut feeds = vec![];
                    for bi in 0..meta.sec.boiler_ids.len() {
                        feeds.push(transport::src_feed_heat_kw(&ctx, bi));
                    }
                    let mut rejs = vec![];
                    for id in &meta.sec.cond_ids {
                        rejs.push(netlive::cond_rej_of(meta, st, &self.tf.cond_ua, &self.tf.cw_ref, cond_frac, id));
                    }
                    println!("p{} tick {si} src[{i}] nm={nm}: got={} want={} mwE={} condP={} eff={} ht={} feeds={feeds:?} rejs={rejs:?} skinmap={skinmap:?} heatbal={hb:?} turbWk={:?} turbP={:?} condT={:?} steamBy={:?}",
                        self.pi, got.src[i], tail.src[i], transport::src_mw_e(&ctx),
                        sim_rs::sec::batchb_cond_p(&meta.sec, &self.patched, &st.sec, exh), self.eff, ht,
                        st.sec.f64s.get("turbWk").copied(), st.sec.f64s.get("turbP").copied(),
                        st.sec.f64s.get("condT").copied(),
                        st.sec.maps.get("steamBy").map(|m| m.keys.clone()).unwrap_or_default());
                }
            }
        }
        if got.metal_qv.len() != tail.metal_qv.len() {
            self.cmp.fail += 1;
            println!("p tick {si}: LIVE-MISMATCH metal_qv.len");
        } else {
            for (i, (&g, &w)) in got.metal_qv.iter().zip(tail.metal_qv.iter()).enumerate() {
                self.cmp.f(si, &format!("metal_qv[{i}]"), g, w);
            }
        }
        if got.metal_qm != tail.metal_qm {
            self.cmp.fail += 1;
            if self.cmp.shown < 40 {
                let bad: Vec<usize> = got.metal_qm.iter().zip(tail.metal_qm.iter()).enumerate()
                    .filter(|(_, (a, b))| a != b).map(|(i, _)| i).take(5).collect();
                println!("p tick {si}: LIVE-MISMATCH metal_qm at {bad:?}");
                self.cmp.shown += 1;
            }
        } else {
            self.cmp.ok += 1;
        }
        // 2. bookedKg + boronPin per node.
        if tail.booked_kg.len() != n || tail.boron_pin.len() != n {
            self.cmp.fail += 1;
            println!("p tick {si}: LIVE-MISMATCH booked/boron len");
        } else {
            for i in 0..n {
                let tid = self.tf.tank_id_by_node.get(&i).map(|s| s.as_str());
                self.cmp.f(si, &format!("booked_kg[{i}]"),
                    transport::live_booked_kg_for(meta, &self.patched, st, tid), tail.booked_kg[i]);
                self.cmp.f(si, &format!("boron_pin[{i}]"),
                    transport::live_boron_pin_for(meta, self.boron0, tid), tail.boron_pin[i]);
            }
        }
        // 3. fallbacks at the pre_advect capture point.
        let (fb_p, fb_h, _) = solvelive::fallbacks_live(meta, &self.patched, st);
        if fb_p.len() != tail.fb_p.len() || fb_h.len() != tail.fb_h.len() {
            self.cmp.fail += 1;
            println!("p tick {si}: LIVE-MISMATCH fb len");
        } else {
            for (i, (&g, &w)) in fb_p.iter().zip(tail.fb_p.iter()).enumerate() {
                self.cmp.f(si, &format!("fb_p[{i}]"), g, w);
            }
            for (i, (&g, &w)) in fb_h.iter().zip(tail.fb_h.iter()).enumerate() {
                self.cmp.f(si, &format!("fb_h[{i}]"), g, w);
            }
        }
        // 4. Tavg reads per circuit.
        for (t2, tc) in meta.trans.tavg_circs.iter().enumerate() {
            let key = meta.sec.circ_key_of.get(tc.ci as usize).and_then(|o| o.as_deref());
            let tref_c = meta.events.circ_tref.get(&tc.ci).copied();
            self.cmp.f(si, &format!("tavg_prev_t[{t2}]"),
                transport::live_tavg_of(key, &st.tavg_by, st.tavg, meta.trans.core_circ, tc.ci, tref_c, meta.events.tref),
                tail.tavg_prev_t[t2]);
            self.cmp.f(si, &format!("tavg_prev_dt[{t2}]"),
                transport::live_dtavg_of(key, &st.dtavg_by, st.dtavg, meta.trans.core_circ, tc.ci),
                tail.tavg_prev_dt[t2]);
        }
        // 5. in-loop + core-member masks (circs*n order).
        let ncirc = meta.trans.tavg_circs.len();
        if tail.tavg_in_loop.len() != ncirc * n || tail.tavg_core_member.len() != ncirc * n {
            self.cmp.fail += 1;
            println!("p tick {si}: LIVE-MISMATCH tavg mask len");
        } else {
            for (t2, tc) in meta.trans.tavg_circs.iter().enumerate() {
                let members = self.tf.trans_nids.get(t2);
                for (i, nm) in meta.sec.net_names.iter().enumerate() {
                    let g = netlive::in_loop_live(&self.tf.loop_nodes, &meta.sec.fold_map,
                        &self.tf.node_run_key, &self.tf.run_ends, tc.ci, nm);
                    self.cmp.b(si, &format!("tavg_in_loop[{t2}][{nm}]"), g,
                        tail.tavg_in_loop[t2 * n + i] != 0);
                    let gm = members.map(|ns| ns.iter().any(|x| x == nm)).unwrap_or(false);
                    self.cmp.b(si, &format!("tavg_core_member[{t2}][{nm}]"), gm,
                        tail.tavg_core_member[t2 * n + i] != 0);
                }
            }
        }
        // 6. rise areas over lanes rebuilt at pre_advect state.
        let (q, gv) = solvelive::lanes_live(meta, &self.patched, self.fr,
            st, &st.solve_carry.warr, exh, false);
        if tail.rise_a.len() != self.tf.trans_rise_e.len() {
            self.cmp.fail += 1;
            println!("p tick {si}: LIVE-MISMATCH rise_a len");
        } else {
            for (k, &e) in self.tf.trans_rise_e.iter().enumerate() {
                let e = e as usize;
                let (kin, _, _) = edge_inputs(&meta.solve, &st.solve_carry.fs,
                    &st.solve_carry.warr, &q[e], &gv[e], e);
                let g = edge::edge_cval(&kin);
                self.cmp.f(si, &format!("rise_a[{k}]"), g, tail.rise_a[k]);
                if std::env::var("BATCHD_DEBUG").is_ok() && !(g == tail.rise_a[k] || (g.is_nan() && tail.rise_a[k].is_nan())) {
                    let wi = meta.solve.wi.get(e).copied().unwrap_or(-1);
                    let wlive = if wi >= 0 { st.solve_carry.warr.get(wi as usize).copied() } else { None };
                    let wwant = if wi >= 0 { self.want_warr.get(wi as usize).copied() } else { None };
                    let e2 = |v: Option<f64>| match v { Some(x) => format!("{x:e}"), None => "none".to_string() };
                    let lanes_live: Vec<String> = q.get(e).map(|v| v.iter().enumerate().filter(|(_, &x)| x != 0.0 && !x.is_nan()).map(|(l, x)| format!("{l}:{x:e}")).collect()).unwrap_or_default();
                    let lanes_dump: Vec<String> = self.tick.solve_tail.edge_q.get(e).map(|v| v.iter().enumerate().filter(|(_, &x)| x != 0.0 && !x.is_nan()).map(|(l, x)| format!("{l}:{x:e}")).collect()).unwrap_or_default();
                    println!("p{} tick {} rise_a[{}] e={} ck={} wi={}: got={:e}({:#x}) want={:e}({:#x}) wlive={} wwant={} qlive=[{}] qdump=[{}]",
                        self.pi, si, k, e, meta.solve.ck.get(e).copied().unwrap_or(-99), wi, g, g.to_bits(), tail.rise_a[k], tail.rise_a[k].to_bits(),
                        e2(wlive), e2(wwant), lanes_live.join(" "), lanes_dump.join(" "));
                }
            }
        }
        // Tick-0 sidecar note: scrMetal is the S0 scratch (zeros), the dump
        // carries this tick's recompute; equality would mean carry semantics.
        if si == 0 {
            let same_qv = self.tf.scr_metal_qv == tail.metal_qv;
            let same_qm = self.tf.scr_metal_qm == tail.metal_qm;
            println!("p{} tick 0: scr_metal==dumped qv={same_qv} qm={same_qm}", self.pi);
            self.cmp.ok += 1;
        }
    }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let frozen = parse_edge_frozen(&std::fs::read_to_string(&a[2]).unwrap());
    let tailfr = parse_tail_frozen(&std::fs::read_to_string(&a[3]).unwrap());
    let mut c = Cur { b: &bytes, o: 0, trace: false };
    let np = c.u32() as usize;
    let ver = c.u32();
    assert!(ver == 1 || ver == 2, "format v1|v2");
    let mut total_ok = 0u32;
    let mut total_fail = 0u32;
    let mut n_ticks = 0u32;
    let mut groups: HashMap<String, u64> = HashMap::new();
    for pi in 0..np {
        let preset = read_preset(&mut c, pi, ver);
        let meta = preset.meta;
        let fr_lib = to_lib_edge(&frozen[pi]);
        let tf = &tailfr[pi];
        let patched = solvelive::patch_curves(&meta.sec_curves, &fr_lib.suggest);
        let max_ci = fr_lib.suggest.keys().copied().max().unwrap_or(23).max(0) as usize;
        let sugg: Vec<f64> = (0..=max_ci).map(|ci| fr_lib.suggest.get(&(ci as i32)).copied().unwrap_or(f64::NAN)).collect();
        let (eff, l_pzr_k) = (tf.eff, tf.pzr_k);
        let mut st = preset.st;
        let ncore = preset.core_ids.len();
        let nticks = c.u32() as usize;
        let mut boron0 = f64::NAN;
        let mut boron0_set = false;
        let mut prev_turb_wk: Option<f64> = None;
        let mut prev_core: HashMap<String, sim_rs::core::CoreState> = HashMap::new();
        let mut prev_room: Option<sim_rs::room::RoomState> = None;
        for ti in 0..nticks {
            let t = read_tick(&mut c, &meta, ncore, pi, ti);
            let Tick { dt, sample, ctl_keys, solve_tail, sec_tail, trans_tail, core_tail, bore, events_tail, trip_near_mid, inject_node, h2_post_vessel, tube, want_ann_sec_p, want_ann_boiler_lvl, want_sec, want_core, want_room, wwarr, .. } = t;
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
            st.tick += 1;
            if std::env::var("BATCHD_DEBUG").is_ok() {
                println!("p{pi} tick {ti}: want_sec turbWk={:?} turbP={:?} condT={:?} steamBy_sg0={:?}",
                    want_sec.f64s.get("turbWk").copied(), want_sec.f64s.get("turbP").copied(),
                    want_sec.f64s.get("condT").copied(),
                    want_sec.maps.get("steamBy").and_then(|m| m.keys.iter().position(|k| k == "sg0").and_then(|p| m.vals.get(p).copied())));
            }
            let tick_ro = tick.clone();
            let mut hook = LiveHook {
                cmp: Cmp { ok: 0, fail: 0, shown: 0, pi, groups: HashMap::new() },
                si: ti,
                pi,
                tick: &tick_ro,
                tf,
                fr: &fr_lib,
                patched: patched.clone(),
                sugg: sugg.clone(),
                eff,
                l_pzr_k,
                boron0,
                boron0_set,
                turb_wk_sub: prev_turb_wk,
                want_warr: &wwarr,
                prev_core: &prev_core,
                prev_room: prev_room.as_ref(),
            };
            step_replay_hook(&meta, &mut st, &mut tick, &mut hook);
            boron0 = hook.boron0;
            boron0_set = hook.boron0_set;
            prev_turb_wk = want_sec.f64s.get("turbWk").copied();
            n_ticks += 1;
            total_ok += hook.cmp.ok;
            total_fail += hook.cmp.fail;
            for (k, v) in hook.cmp.groups {
                *groups.entry(k).or_insert(0) += v;
            }
            prev_core = want_core;
            prev_room = Some(want_room);
            let _ = pi;
        }
    }
    println!("batchd: ok={total_ok} fail={total_fail} ticks={n_ticks}");
    let mut keys: Vec<String> = groups.keys().cloned().collect();
    keys.sort_by(|a, b| groups[b].cmp(&groups[a]));
    for k in keys.iter().take(15) {
        println!("  fails {k}: {}", groups[k]);
    }
}
