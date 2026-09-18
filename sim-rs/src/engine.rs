//! The live engine: one `StageHook` that fills every per-tick tail off the
//! stage-time state instead of a dump, so `step_replay_hook` stays the one
//! march. Every reader here is the one `tail-live` pins against the gate.
use std::collections::HashMap;

use crate::frozen::{TailFrozen, FIT_BORE0};
use crate::live::CtlFrozen;
use crate::netlive::{FixGen, PiecesMemo};
use crate::solvelive::EdgeFrozen;
use crate::step::{
    Carry, CtlMeta, SolveOut, Stage, StageHook, StepMeta, StepOut, StepState, StepTick,
};
use crate::{core, ctl, edge, events, live, netlive, room, sec, solvelive, step, transport};

pub struct Engine {
    pub edge: EdgeFrozen,
    pub tail: TailFrozen,
    pub ctl_fr: CtlFrozen,
    pub ctl_meta: CtlMeta,
    pub ctl_live: live::CtlLive,
    pub memo: PiecesMemo,
    /// Sec curves with the lane-time setpoints spliced in.
    curves: sec::SecCurves,
    /// `suggest` as a per-circuit vector (drum pins index it).
    sugg: Vec<f64>,
    fix_gen: FixGen,
    /// `netNatCirc`'s held answer between recomputes.
    nat: solvelive::NatCarry,
    /// The tail the nat walk's own solves read (pins and rows are the main
    /// solve's; the walk only changes the drive lanes and holds the store).
    nat_tail: step::SolveTail,
    /// Commission boron, the boron pin's reference.
    boron0: f64,
    boron0_set: bool,
    /// Within-tick carry between fills.
    exh: bool,
    cond_frac: f64,
}

impl Engine {
    /// `st` is the commissioned state: the piece memo seeds off its carried
    /// partition under the commission signature, exactly like `P.net.pc`.
    pub fn new(
        meta: &StepMeta,
        st: &StepState,
        carry: &Carry,
        edge: EdgeFrozen,
        tail: TailFrozen,
        mut ctl_fr: CtlFrozen,
        ctl_meta: CtlMeta,
        ctl_live: live::CtlLive,
    ) -> Self {
        ctl_fr.fit_node = tail.fit_node.clone();
        let curves = solvelive::patch_curves(&meta.sec_curves, &edge.suggest);
        let max_ci = edge.suggest.keys().copied().max().unwrap_or(23).max(0) as usize;
        let sugg = (0..=max_ci)
            .map(|ci| edge.suggest.get(&(ci as i32)).copied().unwrap_or(f64::NAN))
            .collect();
        let mut eng = Engine {
            edge,
            tail,
            ctl_fr,
            ctl_meta,
            ctl_live,
            memo: PiecesMemo::default(),
            curves,
            sugg,
            fix_gen: FixGen::default(),
            nat: solvelive::NatCarry::default(),
            nat_tail: step::SolveTail::default(),
            boron0: f64::NAN,
            boron0_set: false,
            exh: false,
            cond_frac: 1.0,
        };
        eng.load(meta, st, carry);
        eng
    }

    /// Takes over a state `read_state` produced: its carry, and the RPS lag
    /// timers the cabinet reads off the vessels.
    pub fn load(&mut self, meta: &StepMeta, st: &StepState, c: &Carry) {
        self.memo = PiecesMemo {
            of: c.pc_of.clone(),
            n: c.pc_n,
            live: c.pc_live.clone(),
            sig: c.pc_sig.clone(),
            valid: true,
        };
        self.nat = solvelive::NatCarry {
            tick: c.nat_tick,
            p_v: c.nat_p_v.clone(),
            p_has: c.nat_p_has.clone(),
            loop_kg: c.nat_loop.clone(),
        };
        self.fix_gen = FixGen { mask: c.fix_mask.clone(), gen: c.fix_gen };
        self.ctl_live.rps_hot = meta.core_ids.iter()
            .map(|id| st.events.vessels.get(id).map(|v| v.rps_hot).unwrap_or(f64::NAN))
            .collect();
    }

    pub fn carry(&self) -> Carry {
        Carry {
            pc_of: self.memo.of.clone(),
            pc_n: self.memo.n,
            pc_live: self.memo.live.clone(),
            pc_sig: self.memo.sig.clone(),
            nat_tick: self.nat.tick,
            nat_p_v: self.nat.p_v.clone(),
            nat_p_has: self.nat.p_has.clone(),
            nat_loop: self.nat.loop_kg.clone(),
            fix_mask: self.fix_gen.mask.clone(),
            fix_gen: self.fix_gen.gen,
        }
    }

    /// One live `stepMarch(dt)`.
    pub fn step(&mut self, meta: &StepMeta, st: &mut StepState, dt: f64) -> StepOut {
        let mut tick = StepTick { dt, ctl_keys: self.ctl_meta.clone(), ..Default::default() };
        st.tick += 1;
        step::step_replay_hook(meta, st, &mut tick, self)
    }

    /// A fresh BFS off the current field, no cache: what the gate's MISS
    /// path dumps (`freshPieces`, post-solve and pre-spill).
    pub fn fresh_pieces(&self, meta: &StepMeta, st: &StepState) -> live::LivePieces {
        let (q, gv) = solvelive::lanes_live(
            meta, &self.curves, &self.edge, st, &st.solve_carry.warr, self.exh, false,
            live::runback_live(meta, st, &self.ctl_fr),
        );
        live::live_pieces(
            &meta.solve, &st.solve_carry.fs, &st.solve_carry.warr, st.solve_carry.choke, &q, &gv,
        )
    }

    fn steam_breaks(&self) -> Vec<(Vec<(i32, i32)>, bool)> {
        self.tail
            .steam_breaks
            .iter()
            .map(|b| (b.cells.clone(), b.exh))
            .collect()
    }

    /// `exhOpenOf`: the frozen break rows against live damage.
    fn exh_of(&self, st: &StepState) -> bool {
        netlive::exh_open_live(&self.steam_breaks(), &st.sec.dmg_parts)
    }

    fn cont_rel_of(&self, meta: &StepMeta, st: &StepState, pid: &str) -> f64 {
        let (px, py) = match meta.sec.part_of.get(pid).and_then(|pi| meta.sec.parts.get(*pi)) {
            Some(p) => (Some(p.x + p.w / 2), Some(p.y + p.h / 2)),
            None => (None, None),
        };
        netlive::cont_rel_live(
            &self.tail.regions, &st.sec.dmg_parts, meta.sec.gw, meta.sec.gh, px, py,
        )
    }

    /// Live hold answers per hold tank: the pins the fixed set needs come
    /// first, then the piece walk decides which holds reach a free node.
    fn hold_live(&self, meta: &StepMeta, st: &StepState, cont: &[(u32, f64)]) -> Vec<bool> {
        let tp0 = netlive::live_tank_pins(
            meta, &self.curves, st, &vec![false; meta.sec.tank_ids.len()],
        );
        let (_, fh) = netlive::fixed_capture(meta, st, cont, &[], &[], &tp0, &[], &[], false);
        let adj = netlive::adj_from_live(
            meta.solve.n, &meta.solve.eu, &meta.solve.ev, &self.memo.live,
        );
        netlive::hold_live_circuits(meta, &adj, &self.memo.live, &fh)
    }

    fn fill_solve(&mut self, meta: &StepMeta, st: &StepState, tick: &mut StepTick) {
        self.exh = self.exh_of(st);
        let fz = &meta.solve;
        let (q, gv) = solvelive::lanes_live(
            meta, &self.curves, &self.edge, st, &st.solve_carry.warr, self.exh, false,
            live::runback_live(meta, st, &self.ctl_fr),
        );
        // Pre-dance pieces: what the pin and hold readers walk.
        solvelive::pieces_live(
            meta, &self.edge, &self.curves, &st.solve_carry.fs, st, &q, &gv,
            &st.solve_carry.warr, &[], &mut self.memo,
        );
        let (fb_p, fb_h, pool) = solvelive::fallbacks_live(meta, &self.curves, st);
        let cont = netlive::live_cont_pairs(
            meta, st, &self.tail.cont_order, &self.tail.cont_cell, &self.tail.part_of_node,
        );
        let cont_p = netlive::live_cont_p(meta, st, &self.tail.cont_cell, &self.tail.part_of_node);
        let hl = self.hold_live(meta, st, &cont);
        let hold_pins = netlive::live_hold_pins(meta, st);
        let drum_pins = netlive::live_drum_pins(meta, &self.sugg);
        let tank_pins = netlive::live_tank_pins(meta, &self.curves, st, &hl);
        let sec_pins = netlive::live_sec_pins(meta, st, &self.tail.sec_t_pairs());
        let cond_p = sec::batchb_cond_p(&meta.sec, &meta.sec_curves, &st.sec, self.exh);
        let cond_pins = netlive::live_cond_pins(meta, cond_p, &fz.cond_v, &self.tail.cond_parts);
        let tank_rows = netlive::live_tank_rows(meta, &self.curves, st, &fz.tank_order, &hl);
        self.cond_frac = live::live_cond_frac(meta, &meta.sec_curves, st);
        let cond_rows = netlive::live_cond_rows(
            meta, &self.curves, st, &fz.cond_v, &self.tail.cond_parts,
            &self.tail.cond_ua, &self.tail.cond_mass, &self.tail.cw_ref, self.cond_frac,
        );
        let load = st.sec.f64s.get("load").copied().unwrap_or(1.0);
        let dump = solvelive::dump_live(
            meta, &self.curves, &self.edge, st, load, self.exh, live::runback_live(meta, st, &self.ctl_fr),
        );
        let work_fr = (0..fz.ne)
            .map(|e| {
                if fz.work.get(e).copied().unwrap_or(0) == 0 {
                    return f64::NAN;
                }
                let m = self.edge.edges.get(e).and_then(|er| er.machine.clone()).unwrap_or_default();
                let piped = self.edge.sec_circ.get(&m).map(|c| (c & 3) == 3).unwrap_or(false);
                let work = edge::turb_work_of(
                    piped, load, self.edge.swallow, self.edge.steam_ref, st.events.turb_trip,
                );
                netlive::turb_work_frac_of(work, dump)
            })
            .collect();
        // The fixed set the divergence key reads is the solve's own, so it
        // is taken after the pins, not off the hold probe above.
        let (_, fh) = netlive::fixed_capture(
            meta, st, &cont, &hold_pins, &drum_pins, &tank_pins, &sec_pins, &cond_pins, false,
        );
        // The solve's own partition: `netFixed` reaches `netPieces` AFTER the
        // field update, so a pre-dance walk is the wrong one to feed it.
        let mut danced = st.solve_carry.clone();
        step::solve_field(
            &step::solve_tables(fz), fz, &fz.curves, &mut danced,
            &st.p_by.v, &st.p_by.has, &st.m_by.v, &st.m_by.has, &st.h_by.v, &st.h_by.has,
            &fb_p, &fb_h, &pool,
        );
        let (_, sig) = solvelive::pieces_live(
            meta, &self.edge, &self.curves, &danced.fs, st, &q, &gv,
            &danced.warr, &[], &mut self.memo,
        );
        let div_sig = netlive::div_topo_live(&sig, 1.0, self.fix_gen.update(&fh));
        let t = &mut tick.solve_tail;
        t.edge_q = q;
        t.edge_gates = gv;
        t.fallback_p = fb_p;
        t.fallback_h = fb_h;
        t.pool_lvl = pool;
        t.pc_of = self.memo.of.clone();
        t.pc_npc = self.memo.n;
        t.pc_live = self.memo.live.clone();
        t.cont = cont;
        t.cont_p = cont_p;
        t.held = false;
        t.hold_pins = hold_pins;
        t.drum_pins = drum_pins;
        t.tank_pins = tank_pins;
        t.sec_pins = sec_pins;
        t.cond_pins = cond_pins;
        t.tank_rows = tank_rows;
        t.cond_rows = cond_rows;
        t.with_cap = true;
        t.warned = false;
        t.widx = vec![];
        t.work_fr = work_fr;
        t.nat_loop = self.nat.loop_kg.clone();
        // The walk solves the same plant with the store held; everything but
        // the drive lanes and the held flag is this solve's own tail.
        self.nat_tail = t.clone();
        self.nat_tail.held = true;
        t.div_sig = div_sig;
        // cwFlowBy refills off the solve, before any sec stage runs.
        tick.sec_tail.run_flow_keys = meta.events.run_keys.clone();
    }

    fn fill_sec(&mut self, meta: &StepMeta, st: &StepState, sout: &SolveOut, tick: &mut StepTick) {
        self.exh = self.exh_of(st);
        solvelive::pieces_read(
            meta, &self.edge, &self.curves, &st.solve_carry.fs, st,
            &st.solve_carry.warr, self.exh, false, live::runback_live(meta, st, &self.ctl_fr), &[], &mut self.memo,
        );
        let sl = &tick.solve_tail;
        let hl = live::live_hold_live(meta, st, sl);
        let pc = live::live_pieces(
            &meta.solve, &st.solve_carry.fs, &st.solve_carry.warr,
            st.solve_carry.choke, &sl.edge_q, &sl.edge_gates,
        );
        let bags = live::batchb_outs(meta, st, sout, sl);
        let t = &mut tick.sec_tail;
        t.hold_live = hl.clone();
        t.stage_fed = meta.sec.sg_ids.iter().chain(meta.sec.ihx_ids.iter())
            .map(|id| live::live_stage_fed(meta, &pc, id)).collect();
        t.tank_p = meta.sec.tank_ids.iter().enumerate()
            .map(|(ti, tid)| {
                let h = meta.sec.hold_tank_ids.iter().position(|&x| x == ti)
                    .map(|hi| hl[hi]).unwrap_or(false);
                live::live_tank_p(meta, &self.curves, st, tid, h)
            })
            .collect();
        t.core_fn = meta.core_ids.iter().map(|id| {
            let kg = live::batchb_core_order(meta).iter().position(|x| x == id)
                .and_then(|p| sout.core_kg_v.get(p).copied()).unwrap_or(0.0);
            let nr = self.tail.core_k_net_ref.get(id).copied().filter(|v| *v > 0.0)
                .unwrap_or_else(|| live::core_net_ref_single(meta));
            let fb = st.sec.f64s.get("flowNet").copied().unwrap_or(f64::NAN);
            (id.clone(), live::core_fn_of(kg, nr, fb))
        }).collect();
        t.exh_open = self.exh;
        t.role_turb_alive = live::live_role_turb_alive(meta, st) as i32;
        t.cont_rel = self.rel_keys(meta).into_iter()
            .map(|(key, pid)| (key, self.cont_rel_of(meta, st, &pid))).collect();
        t.shells_live = meta.sec.relief_sec.iter()
            .filter_map(|fid| live::live_shells_live(meta, st, fid).map(|v| (fid.clone(), v)))
            .collect();
        t.m_by_piece = self.memo.of.clone();
        let cn = meta.solve.core_node as usize;
        t.core_piece = self.memo.of.get(cn).copied().unwrap_or(-1);
        let mut cp: Vec<i32> = meta.solve.core_nodes.iter()
            .filter_map(|&i| self.memo.of.get(i as usize).copied()).collect();
        if cp.is_empty() {
            cp.extend(self.memo.of.get(cn).copied());
        }
        cp.sort();
        cp.dedup();
        t.core_pieces = cp;
        let n_circ = meta.sec.circ_of_core.iter().copied().max().unwrap_or(0) + 1;
        t.in_loop_bits = (0..n_circ).map(|ci| {
            meta.sec.net_names.iter().map(|nm| netlive::in_loop_live(
                &self.tail.loop_nodes, &meta.sec.fold_map,
                &self.tail.node_run_key, &self.tail.run_ends, ci, nm,
            )).collect()
        }).collect();
        t.dgen = self.tail.dgen;
        t.net_burst_gen = st.sec.net_burst_gen;
        t.cond_p = sec::batchb_cond_p(&meta.sec, &meta.sec_curves, &st.sec, self.exh);
        t.panel_hit = sec::batchb_panel_hit(&meta.sec, &st.sec);
        self.cond_frac = live::live_cond_frac(meta, &meta.sec_curves, st);
        t.cond_frac = self.cond_frac;
        t.sec_p = meta.sec.sg_ids.iter().enumerate()
            .map(|(i, id)| (id.clone(), live::sec_sec_p(meta, st, i))).collect();
        t.boiler_lvl = meta.sec.boiler_ids.iter()
            .map(|id| (id.clone(), live::sec_boiler_lvl(meta, &meta.sec_curves, st, id)))
            .collect();
        t.loopp = meta.core_ids.iter().enumerate()
            .map(|(i, id)| (id.clone(), live::loop_p(meta, st, meta.sec.circ_of_core[i])))
            .collect();
        t.q_tank = q_tank_map(meta, &bags);
        t.relief_v = meta.sec.relief_ids.iter().map(|fid| {
            let v = live::batchb_relief_slot(meta, fid)
                .and_then(|p| bags.relief.get(p).copied()).unwrap_or(f64::NAN);
            (fid.clone(), v)
        }).collect();
        let shells = live::batchb_shell_order(meta);
        t.sg_feed = meta.sec.sg_ids.iter().chain(meta.sec.drum_ids.iter()).map(|id| {
            let v = shells.iter().position(|x| x == id)
                .and_then(|p| bags.sg_feed.get(p).copied()).unwrap_or(f64::NAN);
            (id.clone(), v)
        }).collect();
        t.sg_steam = meta.sec.sg_ids.iter().map(|id| {
            let v = shells.iter().position(|x| x == id)
                .and_then(|p| bags.sg_steam.get(p).copied()).unwrap_or(f64::NAN);
            (id.clone(), v)
        }).collect();
        t.run_flow_keys = meta.events.run_keys.clone();
    }

    /// `contRelOf` key set, in the gate's own order.
    fn rel_keys(&self, meta: &StepMeta) -> Vec<(String, String)> {
        let mut out = vec![];
        for fid in &meta.sec.relief_ids {
            out.push((format!("relief:{fid}"), fid.clone()));
        }
        for tid in &meta.sec.tank_ids {
            out.push((format!("tank:{tid}"), tid.clone()));
        }
        for id in &meta.sec.sg_ids {
            out.push((format!("sg:{id}"), id.clone()));
        }
        out
    }

    fn fill_trans(&mut self, meta: &StepMeta, st: &StepState, sout: &SolveOut, tick: &mut StepTick) {
        if !self.boron0_set {
            self.boron0 = st.sec.f64s.get("boron").copied().unwrap_or(f64::NAN);
            self.boron0_set = true;
        }
        let n = meta.trans.n;
        let mut run_flow = HashMap::new();
        for (k, key) in tick.sec_tail.run_flow_keys.iter().enumerate() {
            if let Some(&v) = sout.run_flow_v.get(k) {
                run_flow.insert(key.clone(), v);
            }
        }
        let mut mv = st.metal.v.clone();
        let mut mh = st.metal.has.clone();
        let out = {
            let cx = transport::AdvectSrcCtx {
                meta,
                curves: &self.curves,
                st,
                dt: tick.dt,
                wet: &st.solve_carry.fs.wet,
                run_flow: &run_flow,
                exh_open: self.exh,
                cond_ua: &self.tail.cond_ua,
                cw_ref: &self.tail.cw_ref,
                cond_frac: self.cond_frac,
                suggest: &self.sugg,
                eff: self.tail.eff,
                h_turb: self.tail.h_turb,
                p_rise: transport::live_p_rise(meta.sec.p0),
                pzr_k: transport::live_hold_damp_k(meta) * self.tail.pzr_k,
                turb_wk_override: None,
            };
            transport::live_advect_src(&cx, &mut mv, &mut mh)
        };
        let (fb_p, fb_h, _) = solvelive::fallbacks_live(meta, &self.curves, st);
        let (q, gv) = solvelive::lanes_live(
            meta, &self.curves, &self.edge, st, &st.solve_carry.warr, self.exh, false,
            live::runback_live(meta, st, &self.ctl_fr),
        );
        let t = &mut tick.trans_tail;
        t.src = out.src;
        t.metal_qv = out.metal_qv;
        t.metal_qm = out.metal_qm;
        t.booked_kg = (0..n).map(|i| {
            transport::live_booked_kg_for(
                meta, &self.curves, st, self.tail.tank_id_by_node.get(&i).map(|s| s.as_str()),
            )
        }).collect();
        t.boron_pin = (0..n).map(|i| {
            transport::live_boron_pin_for(
                meta, self.boron0, self.tail.tank_id_by_node.get(&i).map(|s| s.as_str()),
            )
        }).collect();
        t.fb_p = fb_p;
        t.fb_h = fb_h;
        t.tavg_prev_t = vec![];
        t.tavg_prev_dt = vec![];
        t.tavg_in_loop = vec![0; meta.trans.tavg_circs.len() * n];
        t.tavg_core_member = vec![0; meta.trans.tavg_circs.len() * n];
        for (t2, tc) in meta.trans.tavg_circs.iter().enumerate() {
            let key = meta.sec.circ_key_of.get(tc.ci as usize).and_then(|o| o.as_deref());
            let tref_c = meta.events.circ_tref.get(&tc.ci).copied();
            t.tavg_prev_t.push(transport::live_tavg_of(
                key, &st.tavg_by, st.tavg, meta.trans.core_circ, tc.ci, tref_c, meta.events.tref,
            ));
            t.tavg_prev_dt.push(transport::live_dtavg_of(
                key, &st.dtavg_by, st.dtavg, meta.trans.core_circ, tc.ci,
            ));
            let members = self.tail.trans_nids.get(t2);
            for (i, nm) in meta.sec.net_names.iter().enumerate() {
                t.tavg_in_loop[t2 * n + i] = netlive::in_loop_live(
                    &self.tail.loop_nodes, &meta.sec.fold_map,
                    &self.tail.node_run_key, &self.tail.run_ends, tc.ci, nm,
                ) as u8;
                t.tavg_core_member[t2 * n + i] =
                    members.map(|ns| ns.iter().any(|x| x == nm)).unwrap_or(false) as u8;
            }
        }
        t.rise_a = self.tail.trans_rise_e.iter().map(|&e| {
            let e = e as usize;
            let (kin, _, _) = step::edge_inputs(
                &meta.solve, &st.solve_carry.fs, &st.solve_carry.warr, &q[e], &gv[e], e,
            );
            edge::edge_cval(&kin)
        }).collect();
    }

    fn fill_core(&mut self, meta: &StepMeta, st: &StepState, tick: &mut StepTick, rods_only: bool) {
        for (k, id) in meta.core_ids.iter().enumerate() {
            let kk = match meta.core_k.get(id.as_str()) {
                Some(v) => v,
                None => continue,
            };
            let mut t = tick.core_tail.remove(id.as_str()).unwrap_or_default();
            t.sink = live::sink_driver(
                &self.ctl_fr.template.blocks, &self.ctl_fr.arg, ctl::SINK_ROD_STEP, id,
            ).is_some();
            t.tilt_rate = core::live_tilt_rate(kk.rod_rate);
            if rods_only {
                tick.core_tail.insert(id.clone(), t);
                continue;
            }
            let cs = match st.core.get(id.as_str()) {
                Some(v) => v,
                None => continue,
            };
            t.sat = core::live_sat_t(&kk.sat, cs.p_core);
            t.core_dt_max = core::live_core_dt_max(meta.sec.core_dt0);
            t.loop_kg = core::live_loop_kg(
                meta.sec.inv_kg0, meta.sec.rated, meta.sec.p_sat_cp, meta.sec.core_dt0,
            );
            t.dose = meta.sec.dose;
            t.catcher = meta.events.catcher;
            t.rel_part = self.cont_rel_of(meta, st, id);
            let ci = meta.sec.circ_of_core.get(k).copied().unwrap_or(-1);
            let ckey = meta.sec.circ_key_of.get(ci as usize).and_then(|o| o.as_deref());
            let tref_c = meta.events.circ_tref.get(&ci).copied();
            let tavg = transport::live_tavg_of(
                ckey, &st.tavg_by, st.tavg, meta.trans.core_circ, ci, tref_c, meta.events.tref,
            );
            let node = meta.trans.core_idx.get(k).copied().unwrap_or(u32::MAX);
            let (hv, hm) = match (node != u32::MAX, st.advect_cache.as_ref()) {
                (true, Some(cache)) => {
                    let i = node as usize;
                    (cache.core_hv.get(i).copied(), cache.core_hm.get(i).copied().unwrap_or(0) != 0)
                }
                _ => (None, false),
            };
            t.h_in = core::live_core_in_h(
                hv, hm, kk.sat.cp, crate::eos::H_DATUM, tavg, meta.sec.core_dt0, cs.heat,
            );
            let fold = meta.sec.fold_map.get(id.as_str()).map(|s| s.as_str()).unwrap_or(id.as_str());
            let ni = meta.sec.net_index.get(fold).copied();
            let m = ni.and_then(|i| {
                (st.m_by.has.get(i).copied().unwrap_or(0) != 0).then(|| st.m_by.v[i])
            });
            let tc = kk.sat.tc;
            let hot = tc != 0.0 && !tc.is_nan() && kk.tref > tc;
            t.v_leak = core::live_v_leak(kk.core_kg0, m, hot, core::sat_rvl(&kk.sat, cs.p_core));
            t.h2m2 = m.unwrap_or(f64::NAN);
            t.h2m2none = m.is_none();
            let (pre, has) = match ni {
                Some(i) if i < st.h2_by.v.len() => {
                    (st.h2_by.v[i], st.h2_by.has.get(i).copied().unwrap_or(0) != 0)
                }
                _ => (f64::NAN, false),
            };
            t.h2pre = pre;
            t.h2pre_has = has;
            tick.core_tail.insert(id.clone(), t);
        }
    }

    fn fill_events(&mut self, meta: &StepMeta, st: &StepState, tick: &mut StepTick) {
        let blocks = &self.ctl_fr.template.blocks;
        let ids = &self.ctl_meta.core_ids;
        let cab = live::ctl_live(meta, st, &self.ctl_fr);
        let rps_near: Vec<(String, bool)> = meta.core_ids.iter()
            .map(|id| (id.clone(), st.events.vessels.get(id.as_str()).map(|v| v.rps_near).unwrap_or(false)))
            .collect();
        tick.trip_near_mid =
            events::live_trip_near(st.events.scrammed, &rps_near, blocks, ids, &st.blk_out, cab);
        let t = &mut tick.events_tail;
        t.rps_state = events::live_rps_state(blocks, ids, cab);
        t.sink_runback = events::live_sink_runback(blocks, cab);
        t.runback_live = events::live_runback_live(blocks, cab);
        t.dry_ids = netlive::dry_parts_live(
            meta, &st.solve_carry.fs.wet, &self.tail.nodes_of_part,
        );
        t.panel_hit = sec::batchb_panel_hit(&meta.sec, &st.sec);
        t.cond_frac = live::live_cond_frac(meta, &meta.sec_curves, st);
        // The events tail's release fractions are per VESSEL, not the sec
        // tail's relief/tank/shell key set.
        t.cont_rel = meta.core_ids.iter()
            .map(|id| (id.clone(), self.cont_rel_of(meta, st, id))).collect();
        t.party_cells = vec![];
    }

    fn fill_room(&mut self, meta: &StepMeta, st: &StepState, tick: &mut StepTick) {
        let spill: Vec<String> = st.sec.maps.get("spillBy").map(|m| m.keys.clone()).unwrap_or_default();
        let relief: Vec<String> = st.sec.maps.get("reliefVent").map(|m| m.keys.clone()).unwrap_or_default();
        let keys = room::live_bore_keys(&spill, &relief, &|fid| meta.room.vent_key.get(fid).cloned());
        tick.room_tail.bore = keys.into_iter().map(|k| {
            let m = room::live_open_bore_m(
                &k,
                &|fid| self.tail.fit_bore_mm.get(fid).copied().unwrap_or(FIT_BORE0),
                &|t| self.tail.run_bore_mm.get(t).copied().unwrap_or(0.0),
            );
            (k, m)
        }).collect();
    }
}

/// `qTank` per tank: the outs bag has a slot only for the non-hold tanks,
/// and a tank without one reads undefined.
fn q_tank_map(meta: &StepMeta, bags: &live::BatchBags) -> HashMap<String, f64> {
    let order = live::batchb_q_tank_order(meta);
    meta.sec.tank_ids.iter().map(|tid| {
        let v = order.iter().position(|x| x == tid)
            .and_then(|p| bags.q_tank.get(p).copied())
            .unwrap_or(f64::NAN);
        (tid.clone(), v)
    }).collect()
}

/// `h2Total` (step.js:1591): concentration times holdup over the core's
/// circuit, the node's own density where nothing is held.
fn h2_total(meta: &StepMeta, curves: &sec::SecCurves, st: &StepState) -> f64 {
    let mut t = 0.0;
    for (i, nm) in meta.sec.net_names.iter().enumerate() {
        let c = st.h2_by.v.get(i).copied().unwrap_or(0.0);
        if !(c > 0.0) || !meta.sec.in_core_node.get(i).copied().unwrap_or(false) {
            continue;
        }
        let m = if st.m_by.has.get(i).copied().unwrap_or(0) != 0 {
            st.m_by.v[i]
        } else {
            meta.trans.vol.get(i).copied().unwrap_or(0.0) * live::net_rho_at(meta, curves, st, nm)
        };
        t += c * m;
    }
    t
}

impl StageHook for Engine {
    /// `netNatCirc` (pipenet.js:2894): held between recomputes, and on the
    /// 25th tick walked again with the pumps down. The walk owns the solver
    /// scratch: `w` is put back, the field is left on its last pass and then
    /// re-updated off the real state — the pollution the JS leaves too.
    fn nat(&mut self, meta: &StepMeta, st: &mut StepState) -> Option<Vec<f64>> {
        self.nat.tick += 1;
        if !self.nat.loop_kg.is_empty() && self.nat.tick % solvelive::NAT_EVERY != 0 {
            return Some(self.nat.loop_kg.clone());
        }
        let mut carried = std::mem::take(&mut st.solve_carry);
        let w = carried.warr.clone();
        let mut warns = 0u32;
        let mut nat = std::mem::take(&mut self.nat);
        let runback = live::runback_live(meta, st, &self.ctl_fr);
        let out = solvelive::nat_passes(
            meta, &self.edge, &self.curves, st, &mut carried, &mut nat,
            &self.nat_tail, &mut warns, &mut self.memo, runback,
        );
        self.nat = nat;
        carried.warr = w;
        let (fb_p, fb_h, pool) = solvelive::fallbacks_live(meta, &self.curves, st);
        step::solve_field(
            &step::solve_tables(&meta.solve), &meta.solve, &meta.solve.curves, &mut carried,
            &st.p_by.v, &st.p_by.has, &st.m_by.v, &st.m_by.has, &st.h_by.v, &st.h_by.has,
            &fb_p, &fb_h, &pool,
        );
        st.solve_carry = carried;
        Some(out)
    }

    fn ctl_replay(
        &mut self,
        meta: &StepMeta,
        st: &StepState,
        _tick: &mut StepTick,
    ) -> Option<ctl::Replay> {
        Some(live::live_ctl(meta, st, &self.ctl_fr, &mut self.ctl_live))
    }

    fn fill(
        &mut self,
        meta: &StepMeta,
        st: &StepState,
        sout: Option<&SolveOut>,
        at: Stage,
        tick: &mut StepTick,
    ) {
        match at {
            Stage::Rods => self.fill_core(meta, st, tick, true),
            Stage::Solve => self.fill_solve(meta, st, tick),
            // Only `qTank` and `netBurstGen` reach spill→burstDice; the rest
            // of the sec tail is read by the late build, after burstDice.
            Stage::SecEarly => {
                if let Some(o) = sout {
                    let bags = live::batchb_outs(meta, st, o, &tick.solve_tail);
                    tick.sec_tail.q_tank = q_tank_map(meta, &bags);
                    tick.sec_tail.net_burst_gen = st.sec.net_burst_gen;
                }
            }
            Stage::SecLate => {
                if let Some(o) = sout {
                    self.fill_sec(meta, st, o, tick);
                }
            }
            Stage::Trans => {
                if let Some(o) = sout {
                    self.fill_trans(meta, st, o, tick);
                }
            }
            Stage::Room => self.fill_room(meta, st, tick),
            Stage::Core => self.fill_core(meta, st, tick, false),
            Stage::Vessel => tick.h2_post_vessel = h2_total(meta, &self.curves, st),
            Stage::Events => self.fill_events(meta, st, tick),
            Stage::Ann => {
                tick.ann_sec_p = meta.sec.sg_ids.iter().enumerate()
                    .map(|(i, id)| (id.clone(), live::sec_sec_p(meta, st, i))).collect();
                tick.ann_boiler_lvl = meta.sec.boiler_ids.iter()
                    .map(|id| (id.clone(), live::sec_boiler_lvl(meta, &meta.sec_curves, st, id)))
                    .collect();
            }
        }
    }
}
