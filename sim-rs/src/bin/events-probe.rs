//! Events-tail replayer for the §6.6 events gate (`node tools/events-gate.js`).
//! Replays radDoseStep then the stepMarch tail (blast, overpressure,
//! burnFire, cook, evLatch+ann, repair, flowSpin, ledger) per sample from
//! dumped live state and demands exact discrete/event agreement plus
//! sdig-semantics float agreement. Dev-only.
use sim_rs::events::*;
use sim_rs::tick::*;
use std::collections::{HashMap, HashSet};

struct Cur<'a> {
    b: &'a [u8],
    o: usize,
}
impl<'a> Cur<'a> {
    fn u32(&mut self) -> u32 {
        let v = u32::from_le_bytes([self.b[self.o], self.b[self.o + 1], self.b[self.o + 2], self.b[self.o + 3]]);
        self.o += 4;
        v
    }
    fn i32(&mut self) -> i32 {
        let v = i32::from_le_bytes([self.b[self.o], self.b[self.o + 1], self.b[self.o + 2], self.b[self.o + 3]]);
        self.o += 4;
        v
    }
    fn f64(&mut self) -> f64 {
        let v = f64::from_le_bytes([
            self.b[self.o], self.b[self.o + 1], self.b[self.o + 2], self.b[self.o + 3],
            self.b[self.o + 4], self.b[self.o + 5], self.b[self.o + 6], self.b[self.o + 7],
        ]);
        self.o += 8;
        v
    }
    fn u8(&mut self) -> u8 {
        let v = self.b[self.o];
        self.o += 1;
        v
    }
    fn f64a(&mut self, n: usize) -> Vec<f64> {
        (0..n).map(|_| self.f64()).collect()
    }
    fn u8a(&mut self, n: usize) -> Vec<u8> {
        let v = self.b[self.o..self.o + n].to_vec();
        self.o += n;
        v
    }
    fn i32a(&mut self, n: usize) -> Vec<i32> {
        (0..n).map(|_| self.i32()).collect()
    }
    fn u32a(&mut self, n: usize) -> Vec<u32> {
        (0..n).map(|_| self.u32()).collect()
    }
    fn str(&mut self) -> String {
        let n = self.u32() as usize;
        if std::env::var("PROBE_DEBUG").is_ok() && (n > 200 || self.o + n > self.b.len()) {
            eprintln!("STRDBG o={} n={}", self.o, n);
        }
        let v = String::from_utf8(self.b[self.o..self.o + n].to_vec()).unwrap();
        self.o += n;
        v
    }
    fn strs(&mut self, n: usize) -> Vec<String> {
        (0..n).map(|_| self.str()).collect()
    }
    fn strsn(&mut self) -> Vec<String> {
        let n = self.u32() as usize;
        self.strs(n)
    }
    fn strmap(&mut self) -> HashMap<String, f64> {
        let n = self.u32() as usize;
        let mut m = HashMap::new();
        for _ in 0..n {
            let k = self.str();
            let v = self.f64();
            m.insert(k, v);
        }
        m
    }
    fn strmap_u8(&mut self) -> HashMap<String, u8> {
        let n = self.u32() as usize;
        let mut m = HashMap::new();
        for _ in 0..n {
            let k = self.str();
            let v = self.u8();
            m.insert(k, v);
        }
        m
    }
    fn strmap_bool(&mut self) -> HashMap<String, bool> {
        let n = self.u32() as usize;
        let mut m = HashMap::new();
        for _ in 0..n {
            let k = self.str();
            let v = self.u8() != 0;
            m.insert(k, v);
        }
        m
    }
    fn strmap_str(&mut self) -> HashMap<String, String> {
        let n = self.u32() as usize;
        let mut m = HashMap::new();
        for _ in 0..n {
            let k = self.str();
            let v = self.str();
            m.insert(k, v);
        }
        m
    }
}

fn bits(a: f64, b: f64) -> bool {
    a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan())
}

struct Cmp {
    fails: u32,
    worst: f64,
    worst_at: String,
    shown: u32,
}

impl Cmp {
    fn floats(&mut self, si: usize, nm: &str, got: &HashMap<String, f64>, want: &HashMap<String, f64>) {
        let mut gk: Vec<&String> = got.keys().collect();
        let mut wk: Vec<&String> = want.keys().collect();
        gk.sort();
        wk.sort();
        if gk != wk {
            self.fails += 1;
            if self.shown < 1000000 {
                println!("sample {si}: {nm} key mismatch");
                self.shown += 1;
            }
            return;
        }
        for k in gk {
            let (a, b) = (got[k], want[k]);
            if bits(a, b) {
                continue;
            }
            if a.is_nan() || b.is_nan() {
                self.fails += 1;
                if self.shown < 1000000 {
                    println!("sample {si}: {nm}[{k}] {a:e} vs {b:e} (NaN mismatch)");
                    self.shown += 1;
                }
                continue;
            }
            let r = (a - b).abs() / (a.abs() + b.abs() + 1e-30);
            if r > self.worst {
                self.worst = r;
                self.worst_at = format!("sample {si}: {nm}[{k}] {a} vs {b}");
            }
            if r > 1e-6 {
                self.fails += 1;
                if self.shown < 1000000 {
                    println!("sample {si}: {nm}[{k}] {a:e} vs {b:e} (rel {r:e})");
                    self.shown += 1;
                } else {
                    break;
                }
            }
        }
    }
    fn float1(&mut self, si: usize, nm: &str, a: f64, b: f64) {
        if bits(a, b) {
            return;
        }
        if a.is_nan() || b.is_nan() {
            self.fails += 1;
            if self.shown < 1000000 {
                println!("sample {si}: {nm} {a:e} vs {b:e} (NaN mismatch)");
                self.shown += 1;
            }
            return;
        }
        let r = (a - b).abs() / (a.abs() + b.abs() + 1e-30);
        if r > self.worst {
            self.worst = r;
            self.worst_at = format!("sample {si}: {nm} {a} vs {b}");
        }
        if r > 1e-6 {
            self.fails += 1;
            if self.shown < 1000000 {
                println!("sample {si}: {nm} {a:e} vs {b:e} (rel {r:e})");
                self.shown += 1;
            }
        }
    }
    fn text(&mut self, si: usize, nm: &str, a: &str, b: &str) {
        if a != b {
            self.fails += 1;
            if self.shown < 1000000 {
                println!("sample {si}: {nm} {a:?} vs {b:?}");
                self.shown += 1;
            }
        }
    }
    fn strs(&mut self, si: usize, nm: &str, got: &[String], want: &[String]) {
        if got != want {
            self.fails += 1;
            if self.shown < 1000000 {
                println!("sample {si}: {nm} list mismatch {got:?} vs {want:?}");
                self.shown += 1;
            }
        }
    }
    fn grid(&mut self, si: usize, nm: &str, got: &[f64], want: &[f64]) {
        if got.len() != want.len() {
            self.fails += 1;
            if self.shown < 1000000 {
                println!("sample {si}: {nm} len {} vs {}", got.len(), want.len());
                self.shown += 1;
            }
            return;
        }
        for (i, (&a, &b)) in got.iter().zip(want.iter()).enumerate() {
            if bits(a, b) {
                continue;
            }
            if a.is_nan() || b.is_nan() {
                self.fails += 1;
                if self.shown < 1000000 {
                    println!("sample {si}: {nm}[{i}] {a:e} vs {b:e} (NaN mismatch)");
                    self.shown += 1;
                }
                break;
            }
            let r = (a - b).abs() / (a.abs() + b.abs() + 1e-30);
            if r > self.worst {
                self.worst = r;
                self.worst_at = format!("sample {si}: {nm}[{i}] {a} vs {b}");
            }
            if r > 1e-6 {
                self.fails += 1;
                if self.shown < 1000000 {
                    println!("sample {si}: {nm}[{i}] {a:e} vs {b:e} (rel {r:e})");
                    self.shown += 1;
                }
            }
        }
    }
    fn flagmap(&mut self, si: usize, nm: &str, got: &HashMap<String, bool>, want: &HashMap<String, bool>) {
        let mut keys: HashSet<&String> = HashSet::new();
        for k in got.keys() {
            keys.insert(k);
        }
        for k in want.keys() {
            keys.insert(k);
        }
        let mut ks: Vec<&String> = keys.into_iter().collect();
        ks.sort();
        for k in ks {
            let (a, b) = (got.get(k).copied().unwrap_or(false), want.get(k).copied().unwrap_or(false));
            if a != b {
                self.fails += 1;
                if self.shown < 1000000 {
                    println!("sample {si}: {nm}[{k}] {a} vs {b}");
                    self.shown += 1;
                }
            }
        }
    }
    fn flagmap_u8(&mut self, si: usize, nm: &str, got: &HashMap<String, u8>, want: &HashMap<String, u8>) {
        let mut keys: HashSet<&String> = HashSet::new();
        for k in got.keys() {
            keys.insert(k);
        }
        for k in want.keys() {
            keys.insert(k);
        }
        let mut ks: Vec<&String> = keys.into_iter().collect();
        ks.sort();
        for k in ks {
            let (a, b) = (got.get(k).copied().unwrap_or(0), want.get(k).copied().unwrap_or(0));
            if a != b {
                self.fails += 1;
                if self.shown < 1000000 {
                    println!("sample {si}: {nm}[{k}] {a} vs {b}");
                    self.shown += 1;
                }
            }
        }
    }
}

fn read_meta(c: &mut Cur) -> EventsMeta {
    let dbg = std::env::var("PROBE_DEBUG").is_ok();
    if dbg { eprintln!("meta start o={}", c.o); }
    let gw = c.u32() as usize;
    let gh = c.u32() as usize;
    let np = c.u32() as usize;
    let mut parts = Vec::with_capacity(np);
    for _ in 0..np {
        let id = c.str();
        let x = c.i32();
        let y = c.i32();
        let w = c.i32();
        let h = c.i32();
        let role = c.str();
        let name = c.str();
        let pburst = c.f64();
        let pdes = c.f64();
        let tsurv = c.f64();
        let mut face_nodes: [Option<String>; 4] = [None, None, None, None];
        for k in 0..4 {
            let s = c.str();
            if !s.is_empty() {
                face_nodes[k] = Some(s);
            }
        }
        let on = c.str();
        let part_on = if on.is_empty() { None } else { Some(on) };
        let tank_hold = c.u8() != 0;
        parts.push(EvPart { id, x, y, w, h, role, name, pburst, pdes, tsurv, face_nodes, part_on, tank_hold });
    }
    let nh = c.u32() as usize;
    let mut hazards = Vec::with_capacity(nh);
    for _ in 0..nh {
        hazards.push(EvHaz { id: c.str(), x: c.i32(), y: c.i32(), lim: c.f64(), what: c.str() });
    }
    let core_ids = c.strsn();
    let primary_core = c.str();
    let mut cores_rated = HashMap::new();
    for _ in 0..c.u32() {
        cores_rated.insert(c.str(), c.f64());
    }
    let mut cores_nb = HashMap::new();
    for _ in 0..c.u32() {
        cores_nb.insert(c.str(), c.u32() as usize);
    }
    let mut core_ci = HashMap::new();
    for _ in 0..c.u32() {
        core_ci.insert(c.str(), c.i32());
    }
    let mut circ_key = HashMap::new();
    for _ in 0..c.u32() {
        circ_key.insert(c.i32(), c.str());
    }
    let core_circ = c.i32();
    let mut circ_tref = HashMap::new();
    for _ in 0..c.u32() {
        circ_tref.insert(c.i32(), c.f64());
    }
    let mut core_hold = HashMap::new();
    for _ in 0..c.u32() {
        core_hold.insert(c.str(), c.str());
    }
    let mut cores_tref = HashMap::new();
    for _ in 0..c.u32() {
        cores_tref.insert(c.str(), c.f64());
    }
    let mut cores_steam = HashMap::new();
    for _ in 0..c.u32() {
        cores_steam.insert(c.str(), c.f64());
    }
    let tf_ref = c.f64();
    let dnbr0 = c.f64();
    let tref = c.f64();
    let steam_flag = c.f64();
    let rated = c.f64();
    let flow_min = c.f64();
    let p0 = c.f64();
    let rated_steam = c.f64();
    let sg_lift = c.f64();
    let panel_thresh = c.f64();
    let flow_k = c.f64();
    let bkp = c.f64();
    let catcher = c.u8() != 0;
    let fuel_in_coolant = c.u8() != 0;
    let vessel_flag = c.u8() != 0;
    let tank_water_act = c.f64();
    let sg_ids = c.strsn();
    let boiler_ids = c.strsn();
    let pump_ids = c.strsn();
    let tank_ids = c.strsn();
    let relief_fit_ids = c.strsn();
    let rad_ids = c.strsn();
    let primary_pumps: HashSet<String> = c.strsn().into_iter().collect();
    let mut rad_live = HashMap::new();
    for _ in 0..c.u32() {
        rad_live.insert(c.str(), c.u8() != 0);
    }
    let pr = c.str();
    let primary_relief = if pr.is_empty() { None } else { Some(pr) };
    let mut tanks = HashMap::new();
    for _ in 0..c.u32() {
        let id = c.str();
        tanks.insert(
            id,
            EvTank {
                inf: c.u8() != 0,
                hold: c.u8() != 0,
                cell: c.u8() != 0,
                level: c.f64(),
                act: c.f64(),
                kg: c.f64(),
                in_field: c.u8() != 0,
            },
        );
    }
    let node_names: HashSet<String> = c.strsn().into_iter().collect();
    let incore_names: HashSet<String> = c.strsn().into_iter().collect();
    let nb = c.u32() as usize;
    let booked = c.u8a(nb);
    let run_keys = c.strsn();
    let mut run_pos = HashMap::new();
    for _ in 0..c.u32() {
        run_pos.insert(c.str(), c.u32() as usize);
    }
    let mut by_key = HashMap::new();
    for _ in 0..c.u32() {
        let key = c.str();
        if c.u8() != 0 {
            by_key.insert(key, EvRun { k: c.str(), pa: c.str(), pb: c.str() });
        }
    }
    let mut tag_by_key = HashMap::new();
    for _ in 0..c.u32() {
        tag_by_key.insert(c.str(), c.i32());
    }
    let mut net_ref_by_run = HashMap::new();
    for _ in 0..c.u32() {
        net_ref_by_run.insert(c.str(), c.f64());
    }
    let mut steam_book = HashMap::new();
    for _ in 0..c.u32() {
        let key = c.str();
        if c.u8() == 0 {
            continue;
        }
        let vent = c.u8() != 0;
        let taps = c.strsn();
        let dir = c.f64();
        let gens = c.strsn();
        let ends = c.u8() != 0;
        steam_book.insert(key, EvSteamBook { vent, taps, dir, gens, ends });
    }
    let nm = c.u32() as usize;
    let mat_of = c.i32a(nm);
    let crew_some = c.u8() != 0;
    let crew_rect = if crew_some { Some([c.i32(), c.i32(), c.i32(), c.i32()]) } else { None };
    let mut kern_core = Vec::new();
    for _ in 0..c.u32() {
        let id = c.str();
        let m = c.u32() as usize;
        kern_core.push((id, c.f64a(m)));
    }
    let mut kern_sg = Vec::new();
    for _ in 0..c.u32() {
        let m = c.u32() as usize;
        kern_sg.push(c.f64a(m));
    }
    let mut kern_tank = Vec::new();
    for _ in 0..c.u32() {
        let id = c.str();
        let m = c.u32() as usize;
        kern_tank.push((id, c.f64a(m)));
    }
    let kern_pipe = if c.u8() != 0 {
        let m = c.u32() as usize;
        Some(c.f64a(m))
    } else {
        None
    };
    let has_pipe_kernel = kern_pipe.is_some();
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("meta done o={}", c.o);
    }
    EventsMeta {
        gw, gh, parts, hazards, core_ids, primary_core, cores_rated, cores_nb,
        core_ci, circ_key, core_circ, circ_tref, core_hold, cores_tref, cores_steam,
        tf_ref, dnbr0, tref, steam_flag, rated, flow_min, p0, rated_steam, sg_lift,
        panel_thresh, flow_k, bkp, catcher, fuel_in_coolant, tank_water_act, sg_ids, boiler_ids,
        pump_ids, primary_pumps, tank_ids, relief_fit_ids, rad_ids, rad_live,
        primary_relief, tanks, node_names, incore_names, booked, run_keys, run_pos,
        by_key, tag_by_key, net_ref_by_run, steam_book, mat_of, crew_rect,
        kern_core, kern_sg, kern_tank, kern_pipe, has_pipe_kernel, vessel_flag,
    }
}

fn read_inputs(c: &mut Cur, meta: &EventsMeta, dt: f64) -> EventsIn {
    let cav_ids = c.strsn();
    let inj_ids = c.strsn();
    let nr = c.u32() as usize;
    assert_eq!(nr, meta.run_keys.len(), "runflow len");
    let runflow = c.f64a(nr);
    let ledg_m0 = c.f64();
    let ledg_o0 = c.f64();
    let sump_kg = c.f64();
    let cond_p = c.f64();
    let rps_state = c.str();
    let sink_runback = c.u8() != 0;
    let runback_live = c.u8() != 0;
    // trip_near is captured post-cook (live at evLatch time), streamed after
    // post-state: default false here, filled by the caller before replay.
    let trip_near = false;
    let dry_ids = c.strsn();
    let nps = c.u32() as usize;
    assert_eq!(nps, meta.parts.len(), "part_skin len");
    let part_skin = c.f64a(nps);
    let panel_hit = c.f64();
    let cond_frac = c.f64();
    let mut sec_p = HashMap::new();
    for _ in 0..c.u32() {
        sec_p.insert(c.str(), c.f64());
    }
    let mut boiler_lvl = HashMap::new();
    for _ in 0..c.u32() {
        boiler_lvl.insert(c.str(), c.f64());
    }
    let mut loopp_by_core = HashMap::new();
    for _ in 0..c.u32() {
        loopp_by_core.insert(c.str(), c.f64());
    }
    let mut cont_rel = HashMap::new();
    for _ in 0..c.u32() {
        cont_rel.insert(c.str(), c.f64());
    }
    let npc = c.u32() as usize;
    let party_cells = c.u32a(npc).into_iter().map(|v| v as usize).collect();
    let log0 = c.u32();
    EventsIn {
        dt, cav_ids, inj_ids, runflow, ledg_m0, ledg_o0, sump_kg, cond_p,
        rps_state, sink_runback, runback_live, trip_near, dry_ids, part_skin,
        panel_hit, cond_frac, sec_p, boiler_lvl, loopp_by_core, cont_rel, party_cells,
        log0,
    }
}

fn read_state(c: &mut Cur, meta: &EventsMeta) -> EventsState {
    let mut f = HashMap::new();
    for k in [
        "n", "decay", "heat", "dmg", "melt_frac", "tf", "dnbr", "vf", "ox_max", "q_ox",
        "fatigue", "rho", "rod_pos", "parts_xe", "p", "tavg", "lvl", "sc", "cav", "h2",
        "inj_rate", "release", "load", "load_dem", "flow_net", "crew_dose", "dose", "dose_rate",
        "rep_rate", "mass_res", "mass_warn", "room_pmax", "room_burn_on", "room_fire_on",
        "room_bang", "room_max", "spin_v", "spin_tv", "burn_kg", "burn_p", "fire_kg",
        "fire_p", "fire_q", "repair_t", "repair_need",
    ] {
        f.insert(k.to_string(), c.f64());
    }
    let get = |m: &HashMap<String, f64>, k: &str| m.get(k).copied().unwrap_or(f64::NAN);
    let mut u = HashMap::new();
    for k in [
        "scrammed", "breach", "melt", "rod_jam", "rod_band", "blackout", "turb_trip", "cond_lost",
        "party_spent", "burn_blast", "repair_present", "bkp_lost", "sgtr",
    ] {
        u.insert(k.to_string(), c.u8() != 0);
    }
    let uget = |m: &HashMap<String, bool>, k: &str| m.get(k).copied().unwrap_or(false);
    let tick = c.i32();
    let mass_warn_t = c.i32();
    let ann_rev = c.u32();
    let trip = c.str();
    let repair_id = c.str();
    let nd = c.u32() as usize;
    let dec = c.f64a(nd);
    let tank = c.strmap();
    let nmass = c.u32() as usize;
    let mut mass_out = HashMap::with_capacity(nmass);
    let mut mass_out_order = Vec::with_capacity(nmass);
    for _ in 0..nmass {
        let k = c.str();
        let v = c.f64();
        mass_out_order.push(k.clone());
        mass_out.insert(k, v);
    }
    let room_crush = c.strmap();
    let room_hurt = c.strmap();
    let flow_pos = c.strmap();
    let relief_open = c.strmap_bool();
    let relief_blocked = c.strmap_bool();
    let relief_stuck = c.strmap_bool();
    let relief_auto = c.strmap_bool();
    let relief_steam = c.strmap();
    let flow_demby = c.strmap();
    let lvl_by = c.strmap();
    let sc_by = c.strmap();
    let tavg_by = c.strmap();
    let sg_burst = c.strmap_bool();
    let port_shut: HashSet<String> = c.strsn().into_iter().collect();
    let mut ev = HashMap::new();
    for _ in 0..c.u32() {
        ev.insert(c.str(), c.u8() != 0);
    }
    let mut ann_on = HashMap::new();
    for _ in 0..c.u32() {
        ann_on.insert(c.str(), c.u8());
    }
    let dmg_parts = c.strsn();
    let dmg_why = c.strmap_str();
    let n = meta.gw * meta.gh;
    let room_p = c.f64a(n);
    let room_t = c.f64a(n);
    let room_h2 = c.f64a(n);
    let room_m = c.f64a(n);
    let room_vap = c.f64a(n);
    let mut vessels = HashMap::new();
    for _ in 0..c.u32() {
        let id = c.str();
        let v = EvVessel {
            n: c.f64(),
            decay: c.f64(),
            dmg: c.f64(),
            melt_frac: c.f64(),
            dec: {
                let m = c.u32() as usize;
                c.f64a(m)
            },
            tf: c.f64(),
            dnbr: c.f64(),
            vf: c.f64(),
            ox_max: c.f64(),
            q_ox: c.f64(),
            fatigue: c.f64(),
            scrammed: c.u8() != 0,
            breach: c.u8() != 0,
            melt: c.u8() != 0,
            trip: c.str(),
            rod_pos: c.f64(),
            rod_jam: c.u8() != 0,
            rod_band: c.u8() != 0,
            rho: c.f64(),
            parts_xe: c.f64(),
            tilt: c.f64(),
            rod_z: {
                let m = c.u32() as usize;
                c.f64a(m)
            },
            rod_z_dem: {
                let m = c.u32() as usize;
                c.f64a(m)
            },
            tilt_dem: c.f64(),
            rod_dem: c.f64(),
            rps_hot: 0.0,
            rps_near: false,
        };
        vessels.insert(id, v);
    }
    let burn_ids = c.strsn();
    let nm = c.u32() as usize;
    let mby_has = c.u8a(nm);
    let mby_v = c.f64a(nm);
    EventsState {
        tick,
        n: get(&f, "n"),
        decay: get(&f, "decay"),
        dec,
        heat: get(&f, "heat"),
        dmg: get(&f, "dmg"),
        melt_frac: get(&f, "melt_frac"),
        tf: get(&f, "tf"),
        dnbr: get(&f, "dnbr"),
        vf: get(&f, "vf"),
        ox_max: get(&f, "ox_max"),
        q_ox: get(&f, "q_ox"),
        fatigue: get(&f, "fatigue"),
        scrammed: uget(&u, "scrammed"),
        breach: uget(&u, "breach"),
        melt: uget(&u, "melt"),
        trip,
        rod_pos: get(&f, "rod_pos"),
        rod_jam: uget(&u, "rod_jam"),
        rod_band: uget(&u, "rod_band"),
        rho: get(&f, "rho"),
        parts_xe: get(&f, "parts_xe"),
        p: get(&f, "p"),
        tavg: get(&f, "tavg"),
        lvl: get(&f, "lvl"),
        sc: get(&f, "sc"),
        cav: get(&f, "cav"),
        h2: get(&f, "h2"),
        inj_rate: get(&f, "inj_rate"),
        release: get(&f, "release"),
        blackout: uget(&u, "blackout"),
        load: get(&f, "load"),
        load_dem: get(&f, "load_dem"),
        bkp_lost: uget(&u, "bkp_lost"),
        sgtr: uget(&u, "sgtr"),
        flow_net: get(&f, "flow_net"),
        turb_trip: uget(&u, "turb_trip"),
        cond_lost: uget(&u, "cond_lost"),
        crew_dose: get(&f, "crew_dose"),
        dose: get(&f, "dose"),
        dose_rate: get(&f, "dose_rate"),
        rep_rate: get(&f, "rep_rate"),
        party_spent: uget(&u, "party_spent"),
        mass_res: get(&f, "mass_res"),
        mass_warn: get(&f, "mass_warn"),
        mass_warn_t,
        room_pmax: get(&f, "room_pmax"),
        room_burn_on: get(&f, "room_burn_on"),
        room_fire_on: get(&f, "room_fire_on"),
        room_bang: get(&f, "room_bang"),
        room_max: get(&f, "room_max"),
        spin_v: get(&f, "spin_v"),
        spin_tv: get(&f, "spin_tv"),
        ann_rev,
        burn_blast: uget(&u, "burn_blast"),
        burn_kg: get(&f, "burn_kg"),
        burn_p: get(&f, "burn_p"),
        burn_ids,
        fire_kg: get(&f, "fire_kg"),
        fire_p: get(&f, "fire_p"),
        fire_q: get(&f, "fire_q"),
        repair_present: uget(&u, "repair_present"),
        repair_t: get(&f, "repair_t"),
        repair_need: get(&f, "repair_need"),
        repair_id,
        room_p,
        room_t,
        room_h2,
        room_m,
        room_vap,
        vessels,
        tank,
        mby_has,
        mby_v,
        mass_out,
        mass_out_order,
        dmg_parts,
        dmg_why,
        room_crush,
        room_hurt,
        flow_pos,
        ev,
        ann_on,
        relief_open,
        relief_blocked,
        relief_stuck,
        relief_auto,
        relief_steam,
        sg_burst,
        port_shut,
        flow_demby,
        lvl_by,
        sc_by,
        tavg_by,
    }
}

fn compare_state(cmp: &mut Cmp, si: usize, got: &EventsState, want: &EventsState) {
    for (nm, a, b) in [
        ("n", got.n, want.n), ("decay", got.decay, want.decay), ("heat", got.heat, want.heat),
        ("dmg", got.dmg, want.dmg), ("meltFrac", got.melt_frac, want.melt_frac),
        ("Tf", got.tf, want.tf), ("dnbr", got.dnbr, want.dnbr), ("vf", got.vf, want.vf),
        ("oxMax", got.ox_max, want.ox_max), ("qOx", got.q_ox, want.q_ox),
        ("fatigue", got.fatigue, want.fatigue), ("rho", got.rho, want.rho),
        ("rodPos", got.rod_pos, want.rod_pos), ("partsXe", got.parts_xe, want.parts_xe),
        ("P", got.p, want.p), ("Tavg", got.tavg, want.tavg), ("lvl", got.lvl, want.lvl),
        ("sc", got.sc, want.sc), ("cav", got.cav, want.cav), ("h2", got.h2, want.h2),
        ("injRate", got.inj_rate, want.inj_rate), ("release", got.release, want.release),
        ("load", got.load, want.load), ("loadDem", got.load_dem, want.load_dem),
        ("flowNet", got.flow_net, want.flow_net), ("crewDose", got.crew_dose, want.crew_dose),
        ("dose", got.dose, want.dose), ("doseRate", got.dose_rate, want.dose_rate),
        ("repRate", got.rep_rate, want.rep_rate), ("massRes", got.mass_res, want.mass_res),
        ("massWarn", got.mass_warn, want.mass_warn), ("roomPMax", got.room_pmax, want.room_pmax),
        ("roomBurnOn", got.room_burn_on, want.room_burn_on),
        ("roomFireOn", got.room_fire_on, want.room_fire_on),
        ("roomBang", got.room_bang, want.room_bang), ("roomMax", got.room_max, want.room_max),
        ("spinV", got.spin_v, want.spin_v), ("spinTV", got.spin_tv, want.spin_tv),
        ("burnKg", got.burn_kg, want.burn_kg), ("burnP", got.burn_p, want.burn_p),
        ("fireKg", got.fire_kg, want.fire_kg), ("fireP", got.fire_p, want.fire_p),
        ("fireQ", got.fire_q, want.fire_q),
    ] {
        cmp.float1(si, nm, a, b);
    }
    if got.repair_present != want.repair_present {
        cmp.fails += 1;
        if cmp.shown < 1000000 {
            println!("sample {si}: repairPresent {} vs {}", got.repair_present, want.repair_present);
            cmp.shown += 1;
        }
    } else if got.repair_present {
        cmp.float1(si, "repairT", got.repair_t, want.repair_t);
        cmp.float1(si, "repairNeed", got.repair_need, want.repair_need);
        cmp.text(si, "repairId", &got.repair_id, &want.repair_id);
    }
    for (nm, a, b) in [
        ("scrammed", got.scrammed, want.scrammed), ("breach", got.breach, want.breach),
        ("melt", got.melt, want.melt), ("rodJam", got.rod_jam, want.rod_jam),
        ("rodBand", got.rod_band, want.rod_band), ("blackout", got.blackout, want.blackout),
        ("turbTrip", got.turb_trip, want.turb_trip), ("condLost", got.cond_lost, want.cond_lost),
        ("partySpent", got.party_spent, want.party_spent),
        ("burnBlast", got.burn_blast, want.burn_blast),
        ("repairOn", got.repair_present, want.repair_present),
        ("bkpLost", got.bkp_lost, want.bkp_lost), ("sgtr", got.sgtr, want.sgtr),
    ] {
        if a != b {
            cmp.fails += 1;
            if cmp.shown < 1000000 {
                println!("sample {si}: {nm} {a} vs {b}");
                cmp.shown += 1;
            }
        }
    }
    cmp.float1(si, "tick", got.tick as f64, want.tick as f64);
    cmp.float1(si, "massWarnT", got.mass_warn_t as f64, want.mass_warn_t as f64);
    cmp.float1(si, "annRev", got.ann_rev as f64, want.ann_rev as f64);
    cmp.text(si, "trip", &got.trip, &want.trip);
    cmp.floats(si, "tank", &got.tank, &want.tank);
    cmp.floats(si, "massOut", &got.mass_out, &want.mass_out);
    cmp.floats(si, "roomCrush", &got.room_crush, &want.room_crush);
    cmp.floats(si, "roomHurt", &got.room_hurt, &want.room_hurt);
    cmp.floats(si, "flowPos", &got.flow_pos, &want.flow_pos);
    cmp.floats(si, "reliefSteam", &got.relief_steam, &want.relief_steam);
    cmp.floats(si, "flowDemBy", &got.flow_demby, &want.flow_demby);
    cmp.floats(si, "lvlBy", &got.lvl_by, &want.lvl_by);
    cmp.floats(si, "scBy", &got.sc_by, &want.sc_by);
    cmp.floats(si, "tavgBy", &got.tavg_by, &want.tavg_by);
    cmp.flagmap(si, "reliefOpen", &got.relief_open, &want.relief_open);
    cmp.flagmap(si, "reliefBlocked", &got.relief_blocked, &want.relief_blocked);
    cmp.flagmap(si, "reliefStuck", &got.relief_stuck, &want.relief_stuck);
    cmp.flagmap(si, "reliefAuto", &got.relief_auto, &want.relief_auto);
    cmp.flagmap(si, "sgBurst", &got.sg_burst, &want.sg_burst);
    {
        let mut gk: Vec<&String> = got.port_shut.iter().collect();
        let mut wk: Vec<&String> = want.port_shut.iter().collect();
        gk.sort();
        wk.sort();
        if gk != wk {
            cmp.fails += 1;
            if cmp.shown < 1000000 {
                println!("sample {si}: portShut set mismatch");
                cmp.shown += 1;
            }
        }
    }
    cmp.flagmap(si, "ev", &got.ev, &want.ev);
    cmp.flagmap_u8(si, "annOn", &got.ann_on, &want.ann_on);
    cmp.strs(si, "dmgParts", &got.dmg_parts, &want.dmg_parts);
    {
        let mut gk: Vec<&String> = got.dmg_why.keys().collect();
        let mut wk: Vec<&String> = want.dmg_why.keys().collect();
        gk.sort();
        wk.sort();
        if gk != wk {
            cmp.fails += 1;
            if cmp.shown < 1000000 {
                println!("sample {si}: dmgWhyKeys mismatch");
                cmp.shown += 1;
            }
        } else {
            for k in gk {
                if got.dmg_why[k] != want.dmg_why[k] {
                    cmp.fails += 1;
                    if cmp.shown < 1000000 {
                        println!("sample {si}: dmgWhy[{k}] {:?} vs {:?}", got.dmg_why[k], want.dmg_why[k]);
                        cmp.shown += 1;
                    }
                }
            }
        }
    }
    cmp.grid(si, "roomP", &got.room_p, &want.room_p);
    cmp.grid(si, "roomT", &got.room_t, &want.room_t);
    cmp.grid(si, "roomH2", &got.room_h2, &want.room_h2);
    cmp.grid(si, "roomM", &got.room_m, &want.room_m);
    cmp.grid(si, "roomVap", &got.room_vap, &want.room_vap);
    cmp.grid(si, "dec", &got.dec, &want.dec);
    cmp.strs(si, "burnIds", &got.burn_ids, &want.burn_ids);
    // vessels: compare every dumped field per id.
    {
        let mut gk: Vec<&String> = got.vessels.keys().collect();
        let mut wk: Vec<&String> = want.vessels.keys().collect();
        gk.sort();
        wk.sort();
        if gk != wk {
            cmp.fails += 1;
            if cmp.shown < 1000000 {
                println!("sample {si}: vessels key mismatch");
                cmp.shown += 1;
            }
        } else {
            for k in gk {
                let (a, b) = (&got.vessels[k], &want.vessels[k]);
                for (nm, x, y) in [
                    ("n", a.n, b.n), ("decay", a.decay, b.decay), ("dmg", a.dmg, b.dmg),
                    ("meltFrac", a.melt_frac, b.melt_frac), ("Tf", a.tf, b.tf),
                    ("dnbr", a.dnbr, b.dnbr), ("vf", a.vf, b.vf),
                    ("oxMax", a.ox_max, b.ox_max), ("qOx", a.q_ox, b.q_ox),
                    ("fatigue", a.fatigue, b.fatigue), ("rodPos", a.rod_pos, b.rod_pos),
                    ("rho", a.rho, b.rho), ("partsXe", a.parts_xe, b.parts_xe),
                    ("tilt", a.tilt, b.tilt), ("tiltDem", a.tilt_dem, b.tilt_dem),
                    ("rodDem", a.rod_dem, b.rod_dem),
                ] {
                    cmp.float1(si, &format!("core[{k}].{nm}"), x, y);
                }
                for (nm, x, y) in [
                    ("scrammed", a.scrammed, b.scrammed), ("breach", a.breach, b.breach),
                    ("melt", a.melt, b.melt), ("rodJam", a.rod_jam, b.rod_jam),
                    ("rodBand", a.rod_band, b.rod_band),
                ] {
                    if x != y {
                        cmp.fails += 1;
                        if cmp.shown < 1000000 {
                            println!("sample {si}: core[{k}].{nm} {x} vs {y}");
                            cmp.shown += 1;
                        }
                    }
                }
                cmp.text(si, &format!("core[{k}].trip"), &a.trip, &b.trip);
                cmp.grid(si, &format!("core[{k}].dec"), &a.dec, &b.dec);
                cmp.grid(si, &format!("core[{k}].rodZ"), &a.rod_z, &b.rod_z);
                cmp.grid(si, &format!("core[{k}].rodZDem"), &a.rod_z_dem, &b.rod_z_dem);
            }
        }
    }
    // mBy bags: exact length + bytes + values.
    if got.mby_has.len() != want.mby_has.len() || got.mby_v.len() != want.mby_v.len() {
        cmp.fails += 1;
        if cmp.shown < 1000000 {
            println!("sample {si}: mBy len mismatch");
            cmp.shown += 1;
        }
    } else {
        if got.mby_has != want.mby_has {
            cmp.fails += 1;
            if cmp.shown < 1000000 {
                println!("sample {si}: mBy has mismatch");
                cmp.shown += 1;
            }
        }
        cmp.grid(si, "mBy", &got.mby_v, &want.mby_v);
    }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let mut c = Cur { b: &bytes, o: 0 };
    let np = c.u32() as usize;
    assert_eq!(c.u32(), 1, "format v1");
    let mut cmp = Cmp { fails: 0, worst: 0.0, worst_at: String::new(), shown: 0 };
    let mut n_samples = 0u32;
    let mut n_blocks = 0usize;
    for _pi in 0..np {
        let meta = read_meta(&mut c);
        if std::env::var("PROBE_DEBUG").is_ok() {
            eprintln!("preset {_pi} meta ok o={}", c.o);
        }
        let ns = c.u32() as usize;
        for si in 0..ns {
            n_samples += 1;
            let _tag = c.u32();
            let dt = c.f64();
            if std::env::var("PROBE_DEBUG").is_ok() {
                eprintln!("preset {_pi} sample {si} head o={}", c.o);
            }
            let mut inp = read_inputs(&mut c, &meta, dt);
            if std::env::var("PROBE_DEBUG").is_ok() {
                eprintln!("preset {_pi} sample {si} inputs ok o={}", c.o);
            }
            let pre = read_state(&mut c, &meta);
            if std::env::var("PROBE_DEBUG").is_ok() {
                eprintln!("preset {_pi} sample {si} pre ok o={}", c.o);
            }
            let want = read_state(&mut c, &meta);
            inp.trip_near = c.u8() != 0;
            let mut st = pre.clone();
            let f0 = cmp.fails;
            let r = events_replay(&meta, &mut st, &inp);
            compare_state(&mut cmp, si, &st, &want);
            // expected events + warns.
            let ne = c.u32() as usize;
            let mut exp_evs = Vec::with_capacity(ne);
            for _ in 0..ne {
                exp_evs.push((c.u8(), c.u32()));
            }
            let exp_warns = c.u32();
            let got_evs: Vec<(u8, u32)> = r.events.iter().map(|e| (e.sev, e.code)).collect();
            if got_evs != exp_evs {
                cmp.fails += 1;
                if cmp.shown < 1000000 {
                    println!("sample {si}: events mismatch got={got_evs:?} want={exp_evs:?}");
                    cmp.shown += 1;
                }
            }
            if r.warns != exp_warns {
                cmp.fails += 1;
                if cmp.shown < 1000000 {
                    println!("sample {si}: warns {} vs {}", r.warns, exp_warns);
                    cmp.shown += 1;
                }
            }
            n_blocks += 1;
            if cmp.fails != f0 {
                println!("preset {_pi} sample {si}: nfail={}", cmp.fails - f0);
            }
        }
    }
    println!(
        "samples={n_samples} blocks={n_blocks} worst-rel={:.2e} @ {} FAILURES={}",
        cmp.worst, cmp.worst_at, cmp.fails
    );
}
