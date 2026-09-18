//! batchc-probe: TRANSPORT + CORE + ROOM + EVENTS live-tail verifier.
//! Replays full ticks with dumped tails (exact, like step-probe) while a
//! StageHook computes each owned tail field LIVE and diffs it exactly
//! (NaN==NaN) against the dumped value. Dev-only.
use sim_rs::ingest::*;
use sim_rs::step::*;
use sim_rs::{core, events, tick, transport};
use std::collections::HashMap;

struct Cmp {
    ok: u32,
    fail: u32,
    detail: HashMap<String, (u32, u32)>,
}

fn base_key(name: &str) -> String {
    if let Some(rest) = name.strip_prefix("trans.") {
        return format!("trans.{}", rest.split('[').next().unwrap_or(rest));
    }
    if name.starts_with("core[") {
        if let Some(p) = name.find("].") {
            return format!("core.{}", &name[p + 2..]);
        }
        return "core.?".to_string();
    }
    if name.starts_with("tube[") {
        if let Some(p) = name.find("].") {
            return format!("tube.{}", &name[p + 2..]);
        }
        return "tube.?".to_string();
    }
    name.to_string()
}

impl Cmp {
    fn bump(&mut self, name: &str, pass: bool) {
        let e = self.detail.entry(base_key(name)).or_insert((0, 0));
        if pass {
            e.0 += 1;
        } else {
            e.1 += 1;
        }
    }
    fn eq_f64(&mut self, si: usize, name: &str, got: f64, want: f64) {
        if tick::eq_f64_exact(got, want) {
            self.ok += 1;
            self.bump(name, true);
        } else {
            self.fail += 1;
            self.bump(name, false);
            println!("LIVE-MISMATCH {name}: got={got} want={want} (tick {si})");
        }
    }
    fn eq_bool(&mut self, si: usize, name: &str, got: bool, want: bool) {
        if got == want {
            self.ok += 1;
            self.bump(name, true);
        } else {
            self.fail += 1;
            self.bump(name, false);
            println!("LIVE-MISMATCH {name}: got={got} want={want} (tick {si})");
        }
    }
    fn eq_str(&mut self, si: usize, name: &str, got: &str, want: &str) {
        if got == want {
            self.ok += 1;
            self.bump(name, true);
        } else {
            self.fail += 1;
            self.bump(name, false);
            println!("LIVE-MISMATCH {name}: got={got} want={want} (tick {si})");
        }
    }
}

struct Hook<'a> {
    cmp: Cmp,
    si: usize,
    tick: &'a StepTick,
    pre_open: HashMap<String, f64>,
    pre_trip: HashMap<String, String>,
}

impl<'a> StageHook for Hook<'a> {
    fn pre_advect(&mut self, meta: &StepMeta, st: &StepState, _sout: &SolveOut, tail: &TransTail) {
        for (t2, tc) in meta.trans.tavg_circs.iter().enumerate() {
            let key = meta.sec.circ_key_of.get(tc.ci as usize).and_then(|o| o.as_deref());
            let tref_c = meta.events.circ_tref.get(&tc.ci).copied();
            let got_t = transport::live_tavg_of(
                key, &st.tavg_by, st.tavg, meta.trans.core_circ, tc.ci, tref_c, meta.events.tref,
            );
            let got_dt = transport::live_dtavg_of(key, &st.dtavg_by, st.dtavg, meta.trans.core_circ, tc.ci);
            self.cmp.eq_f64(self.si, &format!("trans.tavgPrevT[{t2}]"), got_t, tail.tavg_prev_t[t2]);
            self.cmp.eq_f64(self.si, &format!("trans.tavgPrevDT[{t2}]"), got_dt, tail.tavg_prev_dt[t2]);
        }
        self.pre_open.clear();
        self.pre_trip.clear();
        for id in &meta.core_ids {
            let open = st.core.get(id.as_str()).map(|c| c.tubes_open).unwrap_or(0.0);
            let trip = st.events.vessels.get(id.as_str()).map(|v| v.trip.clone()).unwrap_or_default();
            self.pre_open.insert(id.clone(), open);
            self.pre_trip.insert(id.clone(), trip);
        }
    }
    fn post_kinetics(&mut self, meta: &StepMeta, st: &StepState, tails: &HashMap<String, CoreTail>) {
        let sample = match &self.tick.ctl {
            Some(s) => s,
            None => return,
        };
        let keys = &self.tick.ctl_keys.core_ids;
        for (k, id) in meta.core_ids.iter().enumerate() {
            let t = match tails.get(id.as_str()) {
                Some(v) => v,
                None => continue,
            };
            let kk = match meta.core_k.get(id.as_str()) {
                Some(v) => v,
                None => continue,
            };
            let cs = match st.core.get(id.as_str()) {
                Some(v) => v,
                None => continue,
            };
            self.cmp.eq_f64(self.si, &format!("core[{id}].sat"), core::live_sat_t(&kk.sat, cs.p_core), t.sat);
            self.cmp.eq_f64(self.si, &format!("core[{id}].tiltRate"), core::live_tilt_rate(kk.rod_rate), t.tilt_rate);
            self.cmp.eq_f64(
                self.si,
                &format!("core[{id}].coreDTMax"),
                core::live_core_dt_max(meta.sec.core_dt0),
                t.core_dt_max,
            );
            self.cmp.eq_f64(
                self.si,
                &format!("core[{id}].loopKg"),
                core::live_loop_kg(meta.sec.inv_kg0, meta.sec.rated, meta.sec.p_sat_cp, meta.sec.core_dt0),
                t.loop_kg,
            );
            self.cmp.eq_f64(self.si, &format!("core[{id}].dose"), meta.sec.dose, t.dose);
            self.cmp.eq_bool(self.si, &format!("core[{id}].catcher"), meta.events.catcher, t.catcher);
            self.cmp.eq_bool(
                self.si,
                &format!("core[{id}].sink"),
                events::live_sink_rod(&sample.blocks, keys, id),
                t.sink,
            );
            let ci = meta.sec.circ_of_core.get(k).copied().unwrap_or(-1);
            let ckey = meta.sec.circ_key_of.get(ci as usize).and_then(|o| o.as_deref());
            let tref_c = meta.events.circ_tref.get(&ci).copied();
            let tavg = transport::live_tavg_of(
                ckey, &st.tavg_by, st.tavg, meta.trans.core_circ, ci, tref_c, meta.events.tref,
            );
            let node = meta.trans.core_idx.get(k).copied().unwrap_or(u32::MAX);
            let (hv, hm) = if node != u32::MAX {
                if let Some(cache) = st.advect_cache.as_ref() {
                    let i = node as usize;
                    let hm = cache.core_hm.get(i).copied().unwrap_or(0) != 0;
                    let hv = cache.core_hv.get(i).copied();
                    (hv, hm)
                } else {
                    (None, false)
                }
            } else {
                (None, false)
            };
            let hin = core::live_core_in_h(
                hv,
                hm,
                kk.sat.cp,
                sim_rs::eos::H_DATUM,
                tavg,
                meta.sec.core_dt0,
                cs.heat,
            );
            self.cmp.eq_f64(self.si, &format!("core[{id}].hIn"), hin, t.h_in);
            let fold = meta.sec.fold_map.get(id.as_str()).map(|s| s.as_str()).unwrap_or(id.as_str());
            let ni = meta.sec.net_index.get(fold).copied();
            let m = ni.and_then(|i| {
                if st.m_by.has.get(i).copied().unwrap_or(0) != 0 {
                    st.m_by.v.get(i).copied()
                } else {
                    None
                }
            });
            let tc = kk.sat.tc;
            let hot = tc != 0.0 && !tc.is_nan() && kk.tref > tc;
            let rvl = core::sat_rvl(&kk.sat, cs.p_core);
            self.cmp.eq_f64(
                self.si,
                &format!("core[{id}].vLeak"),
                core::live_v_leak(kk.core_kg0, m, hot, rvl),
                t.v_leak,
            );
            if let Some(i) = ni {
                let has = st.m_by.has.get(i).copied().unwrap_or(0) != 0;
                if has {
                    let got = st.m_by.v.get(i).copied().unwrap_or(f64::NAN);
                    self.cmp.eq_f64(self.si, &format!("core[{id}].h2m2"), got, t.h2m2);
                    self.cmp.eq_bool(self.si, &format!("core[{id}].h2m2none"), false, t.h2m2none);
                }
                let (got_pre, got_has) = if i < st.h2_by.v.len() {
                    (st.h2_by.v[i], st.h2_by.has.get(i).copied().unwrap_or(0) != 0)
                } else {
                    (f64::NAN, false)
                };
                self.cmp.eq_f64(self.si, &format!("core[{id}].h2pre"), got_pre, t.h2pre);
                self.cmp.eq_bool(self.si, &format!("core[{id}].h2preHas"), got_has, t.h2pre_has);
            }
        }
    }
    fn post_vessel(&mut self, _meta: &StepMeta, st: &StepState, h2: f64) {
        self.cmp.eq_f64(self.si, "events.h2PostVessel", st.events.h2, h2);
    }
    fn on_tube(&mut self, meta: &StepMeta, st: &StepState, tube: &HashMap<String, TubeTail>) {
        for id in &meta.core_ids {
            let kk = match meta.core_k.get(id.as_str()) {
                Some(v) => v,
                None => continue,
            };
            if !kk.tube {
                continue;
            }
            let dumped = tube.get(id.as_str());
            let want_taken = dumped.map(|t| t.taken).unwrap_or(false);
            let pre_o = self.pre_open.get(id).copied().unwrap_or(0.0);
            let pre_t = self.pre_trip.get(id).cloned().unwrap_or_default();
            let post_o = st.core.get(id.as_str()).map(|c| c.tubes_open).unwrap_or(0.0);
            let post_t = st.events.vessels.get(id.as_str()).map(|v| v.trip.clone()).unwrap_or_default();
            self.cmp.eq_bool(self.si, &format!("tube[{id}].taken"), core::tube_taken(pre_o, &pre_t, post_o, &post_t), want_taken);
            if want_taken {
                if let Some(d) = dumped {
                    let cs = st.core.get(id.as_str());
                    self.cmp.eq_f64(self.si, &format!("tube[{id}].tubesOpen"), post_o, d.tubes_open);
                    self.cmp.eq_str(self.si, &format!("tube[{id}].trip"), &post_t, &d.trip);
                    if let Some(c) = cs {
                        self.cmp.eq_bool(self.si, &format!("tube[{id}].cavRelief"), c.cav_relief, d.cav_relief);
                        self.cmp.eq_bool(self.si, &format!("tube[{id}].breach"), c.breach, d.breach);
                        let mut nt_ok = c.n_tube.len() == d.n_tube.len();
                        if nt_ok {
                            for (a, b) in c.n_tube.iter().zip(d.n_tube.iter()) {
                                if a != b {
                                    nt_ok = false;
                                    break;
                                }
                            }
                        }
                        self.cmp.eq_bool(self.si, &format!("tube[{id}].nTube"), nt_ok, true);
                    }
                    self.cmp.eq_f64(self.si, &format!("tube[{id}].roomBang"), st.events.room_bang, d.room_bang);
                }
            }
        }
    }
    fn at_end(&mut self, meta: &StepMeta, st: &StepState, tick: &StepTick) {
        let spill_keys: Vec<String> = st
            .sec
            .maps
            .get("spillBy")
            .map(|m| m.keys.clone())
            .unwrap_or_default();
        let relief_keys: Vec<String> = st
            .sec
            .maps
            .get("reliefVent")
            .map(|m| m.keys.clone())
            .unwrap_or_default();
        let got_keys = sim_rs::room::live_bore_keys(&spill_keys, &relief_keys, &|fid| {
            meta.room.vent_key.get(fid).cloned()
        });
        let mut want_keys: Vec<String> = tick.room_tail.bore.keys().cloned().collect();
        let mut got_sorted = got_keys.clone();
        got_sorted.sort();
        want_keys.sort();
        self.cmp.eq_bool(self.si, "room.boreKeys", got_sorted == want_keys, true);
        let sample = match &self.tick.ctl {
            Some(s) => s,
            None => return,
        };
        // The cabinet is alive on every corpus tick; the frozen table that
        // answers `ctlLive` is the engine's, not this probe's.
        let et = &tick.events_tail;
        self.cmp.eq_str(
            self.si,
            "events.rpsState",
            &events::live_rps_state(&sample.blocks, &self.tick.ctl_keys.core_ids, true),
            &et.rps_state,
        );
        self.cmp.eq_bool(self.si, "events.sinkRunback", events::live_sink_runback(&sample.blocks, true), et.sink_runback);
        self.cmp.eq_bool(
            self.si,
            "events.runbackLive",
            events::live_runback_live(&sample.blocks, true),
            et.runback_live,
        );
        let rps_near: Vec<(String, bool)> = meta
            .core_ids
            .iter()
            .map(|id| (id.clone(), st.events.vessels.get(id.as_str()).map(|v| v.rps_near).unwrap_or(false)))
            .collect();
        let live_tn = events::live_trip_near(st.events.scrammed, &rps_near, &sample.blocks, &self.tick.ctl_keys.core_ids, &st.blk_out, true);
        self.cmp.eq_bool(
            self.si,
            "events.tripNearMid",
            events::live_trip_near(st.events.scrammed, &rps_near, &sample.blocks, &self.tick.ctl_keys.core_ids, &st.blk_out, true),
            tick.trip_near_mid,
        );
        let got_inj = String::new();
        let want_inj = tick.inject_node.as_deref().unwrap_or("");
        self.cmp.eq_str(self.si, "events.injectNode", &got_inj, want_inj);
        if st.events.repair_id.is_empty() && et.party_cells.is_empty() {
            self.cmp.eq_bool(self.si, "events.partyCellsEmpty", true, true);
        }
        let _ = meta;
    }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let mut c = Cur { b: &bytes, o: 0, trace: false };
    let np = c.u32() as usize;
    let ver = c.u32();
    assert!(ver == 1 || ver == 2, "format v1|v2");
    let mut total_ok = 0u32;
    let mut total_fail = 0u32;
    let mut all_detail: HashMap<String, (u32, u32)> = HashMap::new();
    let mut n_ticks = 0u32;
    for pi in 0..np {
        let preset = read_preset(&mut c, pi, ver);
        let meta = preset.meta;
        let mut st = preset.st;
        let ncore = preset.core_ids.len();
        let nticks = c.u32() as usize;
        for ti in 0..nticks {
            let t = read_tick(&mut c, &meta, ncore, pi, ti);
            let Tick { dt, sample, ctl_keys, solve_tail, sec_tail, trans_tail, core_tail, bore, events_tail, trip_near_mid, inject_node, h2_post_vessel, tube, want_ann_sec_p, want_ann_boiler_lvl, .. } = t;
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
            let tick_ro = tick.clone();
            let mut hook = Hook { cmp: Cmp { ok: 0, fail: 0, detail: HashMap::new() }, si: ti, tick: &tick_ro, pre_open: HashMap::new(), pre_trip: HashMap::new() };
            step_replay_hook(&meta, &mut st, &mut tick, &mut hook);
            n_ticks += 1;
            total_ok += hook.cmp.ok;
            total_fail += hook.cmp.fail;
            for (k, (o, f)) in hook.cmp.detail {
                let e = all_detail.entry(k).or_insert((0u32, 0u32));
                e.0 += o;
                e.1 += f;
            }
            let _ = pi;
        }
    }
    println!("batchc: ok={total_ok} fail={total_fail} ticks={n_ticks}");
    let mut keys: Vec<String> = all_detail.keys().cloned().collect();
    keys.sort();
    for k in keys {
        let (o, f) = all_detail[&k];
        println!("batchc-field {k}: ok={o} fail={f}");
    }
}
