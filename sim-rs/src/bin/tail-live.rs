//! Live-tail harness: replays full ticks with dumped tails (exact, like
//! step-probe) while the ENGINE fills the same tails off the stage-time
//! state, and diffs the two field by field. The replay's own tick is never
//! written, so a mismatch names the reader, not the cascade. Dev-only.
//! Usage: tail-live <dump.bin> <edge-frozen.json> <tail-frozen.json> [ctl.tbl]
#[path = "shared/probe_common.rs"]
mod common;
use common::{parse_ctl_tbl, parse_edge_frozen, parse_tail_frozen, to_lib_edge};
use sim_rs::engine::Engine;
use sim_rs::ingest::*;
use sim_rs::step::*;
use std::collections::HashMap;

fn cap() -> u32 {
    std::env::var("TAIL_LIVE_CAP").ok().and_then(|v| v.parse().ok()).unwrap_or(20)
}

struct Cmp {
    fails: u32,
    ok: u32,
    bad: u32,
    groups: HashMap<String, u64>,
    pi: usize,
    si: usize,
}

impl Cmp {
    fn note(&mut self, name: &str, what: String) {
        self.bad += 1;
        let base = name.split('[').next().unwrap_or(name).to_string();
        *self.groups.entry(base).or_insert(0) += 1;
        if self.fails < cap() {
            println!("p{} tick {}: LIVE-MISMATCH {name}: {what}", self.pi, self.si);
        }
        self.fails += 1;
    }
    fn f(&mut self, name: &str, got: f64, want: f64) {
        if got == want || (got.is_nan() && want.is_nan()) {
            self.ok += 1;
        } else {
            self.note(name, format!("got={got} want={want}"));
        }
    }
    /// Lanes with a known demand-timing cascade are judged at the sdig bar.
    fn f_rel(&mut self, name: &str, got: f64, want: f64, tol: f64) {
        let rel = (got - want).abs() / (got.abs() + want.abs() + 1e-300);
        if rel <= tol || (got.is_nan() && want.is_nan()) {
            self.ok += 1;
        } else {
            self.note(name, format!("got={got} want={want}"));
        }
    }
    fn b(&mut self, name: &str, got: bool, want: bool) {
        if got == want {
            self.ok += 1;
        } else {
            self.note(name, format!("got={got} want={want}"));
        }
    }
    fn s(&mut self, name: &str, got: &str, want: &str) {
        if got == want {
            self.ok += 1;
        } else {
            self.note(name, format!("got={got} want={want}"));
        }
    }
    fn fs(&mut self, name: &str, got: &[f64], want: &[f64]) {
        if got.len() != want.len() {
            self.note(name, format!("len {} vs {}", got.len(), want.len()));
            return;
        }
        for (i, (&g, &w)) in got.iter().zip(want.iter()).enumerate() {
            self.f(&format!("{name}[{i}]"), g, w);
        }
    }
    fn us(&mut self, name: &str, got: &[u8], want: &[u8]) {
        if got.len() != want.len() {
            self.note(name, format!("len {} vs {}", got.len(), want.len()));
            return;
        }
        for (i, (&g, &w)) in got.iter().zip(want.iter()).enumerate() {
            self.b(&format!("{name}[{i}]"), g != 0, w != 0);
        }
    }
    fn is(&mut self, name: &str, got: &[i32], want: &[i32]) {
        if got.len() != want.len() {
            self.note(name, format!("len {} vs {}", got.len(), want.len()));
            return;
        }
        for (i, (&g, &w)) in got.iter().zip(want.iter()).enumerate() {
            if g == w {
                self.ok += 1;
            } else {
                self.note(&format!("{name}[{i}]"), format!("got={g} want={w}"));
            }
        }
    }
    fn strs(&mut self, name: &str, got: &[String], want: &[String]) {
        if got != want {
            self.note(name, format!("got={got:?} want={want:?}"));
        } else {
            self.ok += 1;
        }
    }
    fn pairs(&mut self, name: &str, got: &[(u32, f64)], want: &[(u32, f64)]) {
        if got.len() != want.len() {
            self.note(name, format!("len {} vs {}", got.len(), want.len()));
            return;
        }
        for (k, (g, w)) in got.iter().zip(want.iter()).enumerate() {
            self.b(&format!("{name}[{k}].node"), g.0 == w.0, true);
            self.f(&format!("{name}[{k}]"), g.1, w.1);
        }
    }
    /// Maps are diffed over the union: a key one side invents is a fail.
    fn map(&mut self, name: &str, got: &HashMap<String, f64>, want: &HashMap<String, f64>) {
        for (k, w) in want {
            match got.get(k) {
                Some(g) => self.f(&format!("{name}[{k}]"), *g, *w),
                None => self.note(&format!("{name}[{k}]"), "missing live".to_string()),
            }
        }
        for k in got.keys() {
            if !want.contains_key(k) {
                self.note(&format!("{name}[{k}]"), "extra live".to_string());
            }
        }
    }
}

/// Diffs the engine's fill of one stage against the dumped tail.
struct EngHook<'a> {
    eng: &'a mut Engine,
    cmp: Cmp,
    /// Whether the pre-solve partition already matched the dump.
    pc_matched: bool,
}

impl<'a> EngHook<'a> {
    fn diff(&mut self, at: Stage, got: &StepTick, want: &StepTick) {
        match at {
            Stage::Rods | Stage::Core => {
                for (id, w) in &want.core_tail {
                    let g = match got.core_tail.get(id) {
                        Some(g) => g,
                        None => {
                            self.cmp.note(&format!("core[{id}]"), "missing live".to_string());
                            continue;
                        }
                    };
                    self.cmp.b(&format!("core[{id}].sink"), g.sink, w.sink);
                    self.cmp.f(&format!("core[{id}].tiltRate"), g.tilt_rate, w.tilt_rate);
                    if at == Stage::Rods {
                        continue;
                    }
                    self.cmp.f(&format!("core[{id}].sat"), g.sat, w.sat);
                    self.cmp.f(&format!("core[{id}].hIn"), g.h_in, w.h_in);
                    self.cmp.f(&format!("core[{id}].relPart"), g.rel_part, w.rel_part);
                    self.cmp.f(&format!("core[{id}].vLeak"), g.v_leak, w.v_leak);
                    self.cmp.f(&format!("core[{id}].loopKg"), g.loop_kg, w.loop_kg);
                    self.cmp.f(&format!("core[{id}].coreDTMax"), g.core_dt_max, w.core_dt_max);
                    self.cmp.f(&format!("core[{id}].dose"), g.dose, w.dose);
                    self.cmp.b(&format!("core[{id}].catcher"), g.catcher, w.catcher);
                    self.cmp.f(&format!("core[{id}].h2m2"), g.h2m2, w.h2m2);
                    self.cmp.b(&format!("core[{id}].h2m2none"), g.h2m2none, w.h2m2none);
                    self.cmp.f(&format!("core[{id}].h2pre"), g.h2pre, w.h2pre);
                    self.cmp.b(&format!("core[{id}].h2preHas"), g.h2pre_has, w.h2pre_has);
                }
            }
            Stage::Solve => {
                let (g, w) = (&got.solve_tail, &want.solve_tail);
                for (e, (gq, wq)) in g.edge_q.iter().zip(w.edge_q.iter()).enumerate() {
                    for (l, (&gv, &wv)) in gq.iter().zip(wq.iter()).enumerate() {
                        // q39 is the formula lane's, off the pre-dance field:
                        // no Ck<0 edge consumes it, so the lanes leave it NaN.
                        if l == 39 {
                            continue;
                        }
                        if l == 8 {
                            self.cmp.f_rel(&format!("solve.edge_q[{l}]"), gv, wv, 1e-6);
                        } else {
                            self.cmp.f(&format!("solve.edge_q[{e}][{l}]"), gv, wv);
                        }
                    }
                }
                for (e, (gg, wg)) in g.edge_gates.iter().zip(w.edge_gates.iter()).enumerate() {
                    self.cmp.fs(&format!("solve.edge_gates[{e}]"), gg, wg);
                }
                self.cmp.fs("solve.fb_p", &g.fallback_p, &w.fallback_p);
                self.cmp.fs("solve.fb_h", &g.fallback_h, &w.fallback_h);
                for (k, (&gp, &wp)) in g.pool_lvl.iter().zip(w.pool_lvl.iter()).enumerate() {
                    self.cmp.f(&format!("solve.pool[{k}]"),
                        gp.unwrap_or(f64::NAN), wp.unwrap_or(f64::NAN));
                }
                // The gate dumps the CACHED partition when the piece cache
                // held and a fresh post-solve BFS when it did not. Matching
                // the cached one here settles it; otherwise `post_solve`
                // demands the fresh walk reproduce it.
                self.pc_matched = g.pc_of == w.pc_of;
                if self.pc_matched {
                    self.cmp.ok += g.pc_of.len() as u32;
                    self.cmp.b("solve.pc_npc", g.pc_npc == w.pc_npc, true);
                    self.cmp.us("solve.pc_live", &g.pc_live, &w.pc_live);
                }
                self.cmp.pairs("solve.cont", &g.cont, &w.cont);
                self.cmp.fs("solve.cont_p", &g.cont_p, &w.cont_p);
                self.cmp.b("solve.held", g.held, w.held);
                self.cmp.pairs("solve.hold_pins", &g.hold_pins, &w.hold_pins);
                self.cmp.pairs("solve.drum_pins", &g.drum_pins, &w.drum_pins);
                self.cmp.pairs("solve.tank_pins", &g.tank_pins, &w.tank_pins);
                self.cmp.pairs("solve.sec_pins", &g.sec_pins, &w.sec_pins);
                self.cmp.pairs("solve.cond_pins", &g.cond_pins, &w.cond_pins);
                if g.tank_rows.len() != w.tank_rows.len() {
                    self.cmp.note("solve.tank_rows", "len".to_string());
                } else {
                    for (k, (gr, wr)) in g.tank_rows.iter().zip(w.tank_rows.iter()).enumerate() {
                        self.cmp.f(&format!("solve.tank_rows[{k}].c"), gr.0, wr.0);
                        self.cmp.f(&format!("solve.tank_rows[{k}].p0"), gr.1, wr.1);
                    }
                }
                if g.cond_rows.len() != w.cond_rows.len() {
                    self.cmp.note("solve.cond_rows", "len".to_string());
                } else {
                    for (k, (gr, wr)) in g.cond_rows.iter().zip(w.cond_rows.iter()).enumerate() {
                        self.cmp.f(&format!("solve.cond_rows[{k}].c"), gr.0, wr.0);
                        self.cmp.f(&format!("solve.cond_rows[{k}].w"), gr.1, wr.1);
                        self.cmp.f(&format!("solve.cond_rows[{k}].p0"), gr.2, wr.2);
                        self.cmp.b(&format!("solve.cond_rows[{k}].wrecked"), gr.3, wr.3);
                        self.cmp.b(&format!("solve.cond_rows[{k}].vacuum"), gr.4, wr.4);
                    }
                }
                self.cmp.b("solve.with_cap", g.with_cap, w.with_cap);
                for (e, (&gw, &ww)) in g.work_fr.iter().zip(w.work_fr.iter()).enumerate() {
                    self.cmp.f_rel(&format!("solve.work_fr[{e}]"), gw, ww, 1e-6);
                }
                self.cmp.fs("solve.nat_loop", &g.nat_loop, &w.nat_loop);
            }
            Stage::SecEarly | Stage::SecLate => {
                let (g, w) = (&got.sec_tail, &want.sec_tail);
                self.cmp.map("sec.q_tank", &g.q_tank, &w.q_tank);
                self.cmp.f("sec.net_burst_gen", g.net_burst_gen, w.net_burst_gen);
                if at == Stage::SecEarly {
                    return;
                }
                for (i, (&gb, &wb)) in g.hold_live.iter().zip(w.hold_live.iter()).enumerate() {
                    self.cmp.b(&format!("sec.hold_live[{i}]"), gb, wb);
                }
                for (i, (&gb, &wb)) in g.stage_fed.iter().zip(w.stage_fed.iter()).enumerate() {
                    self.cmp.b(&format!("sec.stage_fed[{i}]"), gb, wb);
                }
                self.cmp.fs("sec.tank_p", &g.tank_p, &w.tank_p);
                self.cmp.map("sec.core_fn", &g.core_fn, &w.core_fn);
                self.cmp.b("sec.exh_open", g.exh_open, w.exh_open);
                self.cmp.b("sec.role_turb_alive", g.role_turb_alive == w.role_turb_alive, true);
                self.cmp.map("sec.cont_rel", &g.cont_rel, &w.cont_rel);
                for (fid, wl) in &w.shells_live {
                    match g.shells_live.get(fid) {
                        Some(gl) => self.cmp.strs(&format!("sec.shells_live[{fid}]"), gl, wl),
                        None => self.cmp.note(&format!("sec.shells_live[{fid}]"), "missing live".to_string()),
                    }
                }
                self.cmp.is("sec.m_by_piece", &g.m_by_piece, &w.m_by_piece);
                self.cmp.b("sec.core_piece", g.core_piece == w.core_piece, true);
                self.cmp.is("sec.core_pieces", &g.core_pieces, &w.core_pieces);
                for (ci, wr) in w.in_loop_bits.iter().enumerate() {
                    match g.in_loop_bits.get(ci) {
                        Some(gr) => {
                            for (i, (&gb, &wb)) in gr.iter().zip(wr.iter()).enumerate() {
                                self.cmp.b(&format!("sec.in_loop[{ci}][{i}]"), gb, wb);
                            }
                        }
                        None => self.cmp.note(&format!("sec.in_loop[{ci}]"), "missing live".to_string()),
                    }
                }
                self.cmp.f("sec.dgen", g.dgen, w.dgen);
                self.cmp.f("sec.cond_p", g.cond_p, w.cond_p);
                self.cmp.f("sec.panel_hit", g.panel_hit, w.panel_hit);
                self.cmp.f("sec.cond_frac", g.cond_frac, w.cond_frac);
                self.cmp.map("sec.sec_p", &g.sec_p, &w.sec_p);
                self.cmp.map("sec.boiler_lvl", &g.boiler_lvl, &w.boiler_lvl);
                self.cmp.map("sec.loopp", &g.loopp, &w.loopp);
                self.cmp.map("sec.relief_v", &g.relief_v, &w.relief_v);
                self.cmp.map("sec.sg_feed", &g.sg_feed, &w.sg_feed);
                self.cmp.map("sec.sg_steam", &g.sg_steam, &w.sg_steam);
                self.cmp.strs("sec.run_flow_keys", &g.run_flow_keys, &w.run_flow_keys);
            }
            Stage::Trans => {
                let (g, w) = (&got.trans_tail, &want.trans_tail);
                self.cmp.fs("trans.src", &g.src, &w.src);
                self.cmp.fs("trans.metal_qv", &g.metal_qv, &w.metal_qv);
                self.cmp.us("trans.metal_qm", &g.metal_qm, &w.metal_qm);
                self.cmp.fs("trans.booked_kg", &g.booked_kg, &w.booked_kg);
                self.cmp.fs("trans.boron_pin", &g.boron_pin, &w.boron_pin);
                self.cmp.fs("trans.fb_p", &g.fb_p, &w.fb_p);
                self.cmp.fs("trans.fb_h", &g.fb_h, &w.fb_h);
                self.cmp.fs("trans.tavg_prev_t", &g.tavg_prev_t, &w.tavg_prev_t);
                self.cmp.fs("trans.tavg_prev_dt", &g.tavg_prev_dt, &w.tavg_prev_dt);
                self.cmp.us("trans.tavg_in_loop", &g.tavg_in_loop, &w.tavg_in_loop);
                self.cmp.us("trans.tavg_core_member", &g.tavg_core_member, &w.tavg_core_member);
                self.cmp.fs("trans.rise_a", &g.rise_a, &w.rise_a);
            }
            Stage::Room => {
                let (g, w) = (&got.room_tail, &want.room_tail);
                self.cmp.map("room.bore", &g.bore, &w.bore);
            }
            Stage::Vessel => {
                self.cmp.f("events.h2PostVessel", got.h2_post_vessel, want.h2_post_vessel);
            }
            Stage::Events => {
                let (g, w) = (&got.events_tail, &want.events_tail);
                self.cmp.s("events.rpsState", &g.rps_state, &w.rps_state);
                self.cmp.b("events.sinkRunback", g.sink_runback, w.sink_runback);
                self.cmp.b("events.runbackLive", g.runback_live, w.runback_live);
                self.cmp.strs("events.dryIds", &g.dry_ids, &w.dry_ids);
                self.cmp.f("events.panelHit", g.panel_hit, w.panel_hit);
                self.cmp.f("events.condFrac", g.cond_frac, w.cond_frac);
                self.cmp.map("events.contRel", &g.cont_rel, &w.cont_rel);
                self.cmp.b("events.tripNearMid", got.trip_near_mid, want.trip_near_mid);
                // partyCells only fills behind a repair; the corpus is quiet.
                if want.events_tail.party_cells.is_empty() {
                    self.cmp.b("events.partyCells", g.party_cells.is_empty(), true);
                }
            }
            Stage::Ann => {
                self.cmp.map("ann.sec_p", &got.ann_sec_p, &want.ann_sec_p);
                self.cmp.map("ann.boiler_lvl", &got.ann_boiler_lvl, &want.ann_boiler_lvl);
            }
        }
    }
}

impl<'a> StageHook for EngHook<'a> {
    fn fill(
        &mut self,
        meta: &StepMeta,
        st: &StepState,
        sout: Option<&SolveOut>,
        at: Stage,
        tick: &mut StepTick,
    ) {
        // The engine fills a scratch copy of the dumped tick: upstream stays
        // the dump's, so each stage's readers are judged on their own.
        let mut scratch = tick.clone();
        self.eng.fill(meta, st, sout, at, &mut scratch);
        // Room and events are dumped at the END of the tick, not where the
        // march consumes them; both diff in `at_end` against that state.
        if at != Stage::Room && at != Stage::Events {
            self.diff(at, &scratch, tick);
        }
    }

    fn post_solve(&mut self, meta: &StepMeta, st: &StepState, sout: &SolveOut, tail: &SolveTail) {
        // sdig is NaN-blind and never sees these arrays: a NaN here against a
        // finite JS answer is invisible everywhere else.
        for (name, v) in [
            ("edge_kg", &sout.edge_kg), ("run_flow", &sout.run_flow_v), ("by", &sout.by_v),
            ("sgtr", &sout.sgtr_v), ("core_kg", &sout.core_kg_v), ("p_field", &sout.p_field_v),
        ] {
            match v.iter().position(|x| x.is_nan()) {
                Some(i) => self.cmp.note(&format!("solve.nan[{name}]"), format!("at {i}")),
                None => self.cmp.ok += 1,
            }
        }
        if self.pc_matched {
            return;
        }
        let fresh = self.eng.fresh_pieces(meta, st);
        self.cmp.is("solve.pc_miss_of", &fresh.of, &tail.pc_of);
        self.cmp.us("solve.pc_miss_live", &fresh.live, &tail.pc_live);
    }

    fn at_end(&mut self, meta: &StepMeta, st: &StepState, tick: &StepTick) {
        let mut scratch = tick.clone();
        for at in [Stage::Room, Stage::Events] {
            self.eng.fill(meta, st, None, at, &mut scratch);
            self.diff(at, &scratch, tick);
        }
    }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let frozen = parse_edge_frozen(&std::fs::read_to_string(&a[2]).unwrap());
    let mut tailfr = parse_tail_frozen(&std::fs::read_to_string(&a[3]).unwrap());
    let tbl = parse_ctl_tbl(&std::fs::read_to_string(&a[4]).unwrap());
    let mut c = Cur { b: &bytes, o: 0, trace: false };
    let np = c.u32() as usize;
    let ver = c.u32();
    assert!(ver == 1 || ver == 2, "format v1|v2");
    let (mut total_ok, mut total_bad, mut n_ticks) = (0u32, 0u32, 0u32);
    let mut groups: HashMap<String, u64> = HashMap::new();
    for pi in 0..np {
        let preset = read_preset(&mut c, pi, ver);
        let meta = preset.meta;
        let mut st = preset.st;
        let ncore = preset.core_ids.len();
        let nticks = c.u32() as usize;
        let mut eng: Option<Engine> = None;
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
            if eng.is_none() {
                let (fr, lv) = sim_rs::live::freeze_ctl(
                    tick.ctl.clone().expect("ctl sample"), &tbl[pi], &tick.ctl_keys,
                );
                eng = Some(Engine::new(
                    &meta, &st, to_lib_edge(&frozen[pi]), std::mem::take(&mut tailfr[pi]),
                    fr, tick.ctl_keys.clone(), lv,
                ));
            }
            st.tick += 1;
            let mut hook = EngHook {
                eng: eng.as_mut().expect("engine"),
                cmp: Cmp { fails: 0, ok: 0, bad: 0, groups: HashMap::new(), pi, si: ti },
                pc_matched: false,
            };
            step_replay_hook(&meta, &mut st, &mut tick, &mut hook);
            n_ticks += 1;
            total_ok += hook.cmp.ok;
            total_bad += hook.cmp.bad;
            for (k, v) in hook.cmp.groups {
                *groups.entry(k).or_insert(0) += v;
            }
        }
    }
    println!("tail-live: ticks={n_ticks} live_ok={total_ok} live_fail={total_bad}");
    let mut keys: Vec<String> = groups.keys().cloned().collect();
    keys.sort_by(|a, b| groups[b].cmp(&groups[a]));
    for k in keys.iter().take(15) {
        println!("  fails {k}: {}", groups[k]);
    }
}
