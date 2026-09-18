//! Batch-B live sec-tail probe: replays full ticks with dumped tails (exact,
//! like step-probe) while post_early computes every batch-B SEC-tail field
//! LIVE from replay state and diffs it against the dumped value. Dev-only.
use sim_rs::ingest::*;
use sim_rs::live;
use sim_rs::sec;
use sim_rs::step::*;
use std::collections::HashMap;

struct Cmp {
    ok: u32,
    fail: u32,
    skip: u32,
    shown: u32,
}

impl Cmp {
    fn f(&mut self, si: usize, name: &str, got: f64, want: f64) {
        if got == want || (got.is_nan() && want.is_nan()) {
            self.ok += 1;
        } else {
            self.fail += 1;
            if self.shown < 40 {
                println!("tick {si}: LIVE-MISMATCH {name}: got={got} want={want}");
                self.shown += 1;
            }
        }
    }
    fn b(&mut self, si: usize, name: &str, got: bool, want: bool) {
        if got == want {
            self.ok += 1;
        } else {
            self.fail += 1;
            if self.shown < 40 {
                println!("tick {si}: LIVE-MISMATCH {name}: got={got} want={want}");
                self.shown += 1;
            }
        }
    }
    fn map(&mut self, si: usize, prefix: &str, keys: &[String], get: &dyn Fn(&str) -> f64, want: &HashMap<String, f64>) {
        for k in keys {
            self.f(si, &format!("{prefix}[{k}]"), get(k), want.get(k).copied().unwrap_or(f64::NAN));
        }
        if keys.len() != want.len() {
            self.fail += 1;
            if self.shown < 40 {
                println!("tick {si}: LIVE-MISMATCH {prefix}.len: got={} want={}", keys.len(), want.len());
                self.shown += 1;
            }
        } else {
            self.ok += 1;
        }
    }
}

struct LiveHook<'a> {
    cmp: Cmp,
    si: usize,
    pi: usize,
    tick: &'a StepTick,
}

impl<'a> StageHook for LiveHook<'a> {
    fn post_early(&mut self, meta: &StepMeta, st: &StepState, sout: &SolveOut, tail: &SecTail) {
        let si = self.si;
        let solve_tail = &self.tick.solve_tail;
        // 1. hold_live per holdTankIds
        let hl = live::live_hold_live(meta, st, solve_tail);
        for (i, (g, w)) in hl.iter().zip(tail.hold_live.iter()).enumerate() {
            self.cmp.b(si, &format!("hold_live[{i}]"), *g, *w);
        }
        if hl.len() != tail.hold_live.len() {
            self.cmp.fail += 1;
            println!("tick {si}: LIVE-MISMATCH hold_live.len: got={} want={}", hl.len(), tail.hold_live.len());
        } else {
            self.cmp.ok += 1;
        }
        // shared live pieces for stage_fed
        let pc = live::live_pieces(
            &meta.solve,
            &st.solve_carry.fs,
            &st.solve_carry.warr,
            st.solve_carry.choke,
            &solve_tail.edge_q,
            &solve_tail.edge_gates,
        );
        if std::env::var("BATCHB_DIAG").is_ok() {
            let n = pc.live.len().min(solve_tail.pc_live.len());
            let agree = pc.live[..n].iter().zip(&solve_tail.pc_live[..n]).filter(|(a, b)| a == b).count();
            eprintln!("tick {si}: pieces live agree {agree}/{n} npc={} dumped={}", pc.npc, solve_tail.pc_npc);
        }
        // 2. stage_fed per sg+ihx
        let ids: Vec<String> = meta.sec.sg_ids.iter().chain(meta.sec.ihx_ids.iter()).cloned().collect();
        if ids.len() != tail.stage_fed.len() {
            self.cmp.fail += 1;
            println!("tick {si}: LIVE-MISMATCH stage_fed.len: got={} want={}", ids.len(), tail.stage_fed.len());
        } else {
            self.cmp.ok += 1;
        }
        for (i, id) in ids.iter().enumerate() {
            if let Some(w) = tail.stage_fed.get(i) {
                self.cmp.b(si, &format!("stage_fed[{id}]"), live::live_stage_fed(meta, &pc, id), *w);
            }
        }
        // 3. tank_p per tankIds (needs holdLive per circuit)
        let hl_of = |tid: &str| -> bool {
            meta.sec.hold_tank_ids.iter().enumerate().find_map(|(hi, &ti)| {
                if meta.sec.tank_ids.get(ti).map(|s| s.as_str()) == Some(tid) { hl.get(hi).copied() } else { None }
            }).unwrap_or(false)
        };
        for tid in &meta.sec.tank_ids {
            let got = live::live_tank_p(meta, &meta.sec_curves, st, tid, hl_of(tid));
            let want = tail.tank_p.get(meta.sec.tank_ids.iter().position(|t| t == tid).unwrap_or(usize::MAX)).copied().unwrap_or(f64::NAN);
            self.cmp.f(si, &format!("tank_p[{tid}]"), got, want);
        }
        // 4. core_fn per core id
        let core_order = live::batchb_core_order(meta);
        for id in &meta.core_ids {
            let want = tail.core_fn.get(id).copied().unwrap_or(f64::NAN);
            let kg = core_order.iter().position(|x| x == id).and_then(|p| sout.core_kg_v.get(p).copied()).unwrap_or(0.0);
            let k = meta.core_k.get(id.as_str());
            let nr = if meta.core_ids.len() == 1 {
                live::core_net_ref_single(meta)
            } else {
                k.map(|k| live::core_net_ref_split(meta, k)).unwrap_or(0.0)
            };
            let fb = st.sec.f64s.get("flowNet").copied().unwrap_or(f64::NAN);
            self.cmp.f(si, &format!("core_fn[{id}]"), live::core_fn_of(kg, nr, fb), want);
        }
        // 5a. exh_open
        let exh = match live::live_exh_open(st) {
            Some(b) => {
                self.cmp.b(si, "exh_open", b, tail.exh_open);
                Some(b)
            }
            None => {
                self.cmp.skip += 1;
                println!("tick {si} pi {}: SKIP exh_open (pipe/port damage present, dumped={})", self.pi, tail.exh_open);
                None
            }
        };
        // 5b. role_turb_alive (gate truncates the fraction with |0)
        let fract = live::live_role_turb_alive(meta, st);
        self.cmp.b(si, "role_turb_alive", fract as i32 == tail.role_turb_alive, true);
        if std::env::var("BATCHB_DIAG").is_ok() {
            eprintln!("tick {si}: role_turb fract={fract} want={}", tail.role_turb_alive);
        }
        // 5c. cont_rel
        let mut crel_keys: Vec<String> = meta.sec.relief_ids.iter().map(|f| format!("relief:{f}")).collect();
        crel_keys.extend(meta.sec.tank_ids.iter().map(|t| format!("tank:{t}")));
        crel_keys.extend(meta.sec.sg_ids.iter().map(|t| format!("sg:{t}")));
        self.cmp.map(si, "cont_rel", &crel_keys, &|k| {
            let pid = k.split_once(':').map(|(_, r)| r).unwrap_or(k);
            live::live_cont_rel(meta, st, pid)
        }, &tail.cont_rel);
        // 5d. shells_live per reliefSecIds
        for fid in &meta.sec.relief_sec {
            match live::live_shells_live(meta, st, fid) {
                Some(got) => {
                    let want = tail.shells_live.get(fid).cloned().unwrap_or_default();
                    if got == want {
                        self.cmp.ok += 1;
                    } else {
                        self.cmp.fail += 1;
                        if self.cmp.shown < 40 {
                            println!("tick {si}: LIVE-MISMATCH shells_live[{fid}]: got={got:?} want={want:?}");
                            self.cmp.shown += 1;
                        }
                    }
                }
                None => {
                    self.cmp.skip += 1;
                    println!("tick {si}: SKIP shells_live[{fid}] (ports shut)");
                }
            }
        }
        // 5e. sec_p / boiler_lvl / loopp
        for (sii, id) in meta.sec.sg_ids.iter().enumerate() {
            self.cmp.f(si, &format!("sec_p[{id}]"), live::sec_sec_p(meta, st, sii), tail.sec_p.get(id).copied().unwrap_or(f64::NAN));
        }
        for id in &meta.sec.boiler_ids {
            self.cmp.f(si, &format!("boiler_lvl[{id}]"), live::sec_boiler_lvl(meta, &meta.sec_curves, st, id), tail.boiler_lvl.get(id).copied().unwrap_or(f64::NAN));
        }
        for (cii, id) in meta.core_ids.iter().enumerate() {
            let ci = meta.sec.circ_of_core.get(cii).copied().unwrap_or(-1);
            self.cmp.f(si, &format!("loopp[{id}]"), live::loop_p(meta, st, ci), tail.loopp.get(id).copied().unwrap_or(f64::NAN));
        }
        // 5f. cond_p / panel_hit / cond_frac
        if let Some(e) = exh {
            self.cmp.f(si, "cond_p", sec::batchb_cond_p(&meta.sec, &meta.sec_curves, &st.sec, e), tail.cond_p);
        } else {
            self.cmp.skip += 1;
        }
        self.cmp.f(si, "panel_hit", sec::batchb_panel_hit(&meta.sec, &st.sec), tail.panel_hit);
        self.cmp.f(si, "cond_frac", live::live_cond_frac(meta, &meta.sec_curves, st), tail.cond_frac);
        // 5g. outsBag fields over live netOut
        let bags = live::batchb_outs(meta, st, sout, solve_tail);
        let qord = live::batchb_q_tank_order(meta);
        if qord.len() != bags.q_tank.len() {
            self.cmp.fail += 1;
            println!("tick {si}: LIVE-MISMATCH q_tank.len: got={} want-bags={}", qord.len(), bags.q_tank.len());
        } else {
            self.cmp.ok += 1;
        }
        for (p, tid) in qord.iter().enumerate() {
            self.cmp.f(si, &format!("q_tank[{tid}]"), bags.q_tank.get(p).copied().unwrap_or(f64::NAN), tail.q_tank.get(tid).copied().unwrap_or(f64::NAN));
        }
        for fid in &meta.sec.relief_ids {
            let got = live::batchb_relief_slot(meta, fid).and_then(|p| bags.relief.get(p).copied()).unwrap_or(f64::NAN);
            self.cmp.f(si, &format!("relief_v[{fid}]"), got, tail.relief_v.get(fid).copied().unwrap_or(f64::NAN));
        }
        let shord = live::batchb_shell_order(meta);
        let feed_ids: Vec<String> = meta.sec.sg_ids.iter().chain(meta.sec.drum_ids.iter()).cloned().collect();
        for id in &feed_ids {
            let got = shord.iter().position(|x| x == id).and_then(|p| bags.sg_feed.get(p).copied()).unwrap_or(f64::NAN);
            self.cmp.f(si, &format!("sg_feed[{id}]"), got, tail.sg_feed.get(id).copied().unwrap_or(f64::NAN));
        }
        for id in &meta.sec.sg_ids {
            let got = shord.iter().position(|x| x == id).and_then(|p| bags.sg_steam.get(p).copied()).unwrap_or(f64::NAN);
            self.cmp.f(si, &format!("sg_steam[{id}]"), got, tail.sg_steam.get(id).copied().unwrap_or(f64::NAN));
        }
        if std::env::var("BATCHB_DIAG").is_ok() && (self.pi == 7 || self.pi == 8) {
            eprintln!("tick {} pi {}: reliefbags={:?} reliefV={:?}", si, self.pi, bags.relief, tail.relief_v);
        }
        if std::env::var("BATCHB_DIAG").is_ok() && (self.pi == 5 || self.pi == 8) {
            for id in &meta.core_ids {
                let want = tail.core_fn.get(id).copied().unwrap_or(f64::NAN);
                let pos = core_order.iter().position(|x| x == id).unwrap_or(usize::MAX);
                let kg = sout.core_kg_v.get(pos).copied().unwrap_or(0.0);
                let implied = if want != 0.0 { kg / want } else { f64::NAN };
                eprintln!("tick {si} diag core {id}: implied={implied:.17e} plantref={:.17e}", meta.solve.net_ref);
            }
        }
        // 6. run_flow_keys vs frozen order
        if tail.run_flow_keys == meta.events.run_keys {
            self.cmp.ok += 1;
        } else {
            self.cmp.fail += 1;
            if self.cmp.shown < 40 {
                println!("tick {si}: LIVE-MISMATCH run_flow_keys: got={:?} want={:?}", tail.run_flow_keys, meta.events.run_keys);
                self.cmp.shown += 1;
            }
        }
        // net_burst_gen live scalar
        self.cmp.f(si, "net_burst_gen", st.sec.net_burst_gen, tail.net_burst_gen);
        if std::env::var("BATCHB_DIAG").is_ok() && si == 0 {
            eprintln!("diag relief_ids={:?} reliefVkeys={:?} sg={:?} drum={:?} tanks={:?} tnode={:?} core_kg_len={} qlen={} rlen={} sglen={}",
                meta.sec.relief_ids,
                tail.relief_v.keys().collect::<Vec<_>>(),
                meta.sec.sg_ids, meta.sec.drum_ids, meta.sec.tank_ids, meta.sec.tank_node,
                sout.core_kg_v.len(), bags.q_tank.len(), bags.relief.len(), bags.sg_steam.len());
            eprintln!("diag reliefbags={:?} reliefV={:?} qbags={:?} qTank={:?} sgbags={:?} sgSteam={:?} sgFeed={:?}",
                bags.relief, tail.relief_v, bags.q_tank, tail.q_tank, bags.sg_steam, tail.sg_steam, tail.sg_feed);
            eprintln!("diag rnode={:?} fits_spring={:?}",
                meta.sec.relief_node,
                meta.sec.fits.iter().map(|f| f.spring).collect::<Vec<_>>());
        }
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
    let mut total_skip = 0u32;
    let mut n_ticks = 0u32;
    for pi in 0..np {
        let preset = read_preset(&mut c, pi, ver);
        let meta = preset.meta;
        let mut st = preset.st;
        let ncore = preset.core_ids.len();
        let nticks = c.u32() as usize;
        let mut dgen0: Option<f64> = None;
        for ti in 0..nticks {
            let t = read_tick(&mut c, &meta, ncore, pi, ti);
            let Tick { dt, sample, ctl_keys, solve_tail, sec_tail, trans_tail, core_tail, bore, events_tail, trip_near_mid, inject_node, h2_post_vessel, tube, want_ann_sec_p, want_ann_boiler_lvl, .. } = t;
            match dgen0 {
                None => dgen0 = Some(sec_tail.dgen),
                Some(v) => {
                    total_ok += 1;
                    if sec_tail.dgen != v {
                        total_fail += 1;
                        println!("preset {pi} tick {ti}: LIVE-MISMATCH dgen: got={} want-first={v}", sec_tail.dgen);
                    }
                }
            }
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
            let mut hook = LiveHook { cmp: Cmp { ok: 0, fail: 0, skip: 0, shown: 0 }, si: ti, pi, tick: &tick_ro };
            step_replay_hook(&meta, &mut st, &mut tick, &mut hook);
            n_ticks += 1;
            total_ok += hook.cmp.ok;
            total_fail += hook.cmp.fail;
            total_skip += hook.cmp.skip;
            let _ = pi;
        }
    }
    println!("batchb: ok={total_ok} fail={total_fail} skip={total_skip} ticks={n_ticks}");
}
