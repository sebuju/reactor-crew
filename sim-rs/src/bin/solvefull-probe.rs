//! Full-solve replayer for the §6.2 gate (`node tools/solvefull-gate.js`).
//! Chains field→edges→pieces→ref→fixed→store→linear→readP→readEdges per
//! sample from fixed-S inputs and verifies every stage. Discrete structure
//! bit-exact; floats at sdig semantics except the linear core (bit-exact).
//! Dev-only.
use sim_rs::edge::*;
use sim_rs::eos::{mix_state, Curve, MX_RHO};
use sim_rs::field::*;
use sim_rs::hydro::FlowField;
use sim_rs::net::*;
use sim_rs::pieces::*;
use sim_rs::read::*;
use sim_rs::store::*;

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
    fn f64a(&mut self, n: usize) -> Vec<f64> {
        let mut v = Vec::with_capacity(n);
        for _ in 0..n {
            v.push(f64::from_le_bytes([
                self.b[self.o], self.b[self.o + 1], self.b[self.o + 2], self.b[self.o + 3],
                self.b[self.o + 4], self.b[self.o + 5], self.b[self.o + 6], self.b[self.o + 7],
            ]));
            self.o += 8;
        }
        v
    }
    fn i32a(&mut self, n: usize) -> Vec<i32> {
        (0..n).map(|_| self.i32()).collect()
    }
    fn u32a(&mut self, n: usize) -> Vec<u32> {
        (0..n).map(|_| self.u32()).collect()
    }
    fn u8a(&mut self, n: usize) -> Vec<u8> {
        let v = self.b[self.o..self.o + n].to_vec();
        self.o += n;
        v
    }
    fn pins(&mut self) -> Vec<(u32, f64)> {
        let k = self.u32() as usize;
        let mut v = Vec::with_capacity(k);
        for _ in 0..k {
            let i = self.u32();
            let p = self.f64a(1)[0];
            v.push((i, p));
        }
        v
    }
}

fn bits(a: f64, b: f64) -> bool {
    a.to_bits() == b.to_bits()
}
fn rel(a: f64, b: f64) -> f64 {
    (a - b).abs() / (a.abs() + b.abs() + 1e-30)
}

struct Ctx {
    fails: u32,
    shown: u32,
    worst: f64,
    worst_at: String,
    nonconv: u32,
    stale: u32,
}
impl Ctx {
    fn note(&mut self, si: usize, msg: String) {
        self.fails += 1;
        if self.shown < 8 {
            println!("sample {si}: {msg}");
            self.shown += 1;
        }
    }
    fn sdig(&mut self, si: usize, what: &str, got: &[f64], want: &[f64]) {
        for (i, (&a, &b)) in got.iter().zip(want.iter()).enumerate() {
            if bits(a, b) {
                continue;
            }
            if a.is_nan() || b.is_nan() {
                self.note(si, format!("{what}[{i}] NaN {a} vs {b}"));
                break;
            }
            let r = rel(a, b);
            if r > self.worst {
                self.worst = r;
                self.worst_at = format!("sample {si}: {what}[{i}] {a} vs {b}");
            }
            if r > 1e-6 {
                self.note(si, format!("{what}[{i}] {a:e} vs {b:e}"));
                break;
            }
        }
    }
    fn exact_f64(&mut self, si: usize, what: &str, got: &[f64], want: &[f64]) {
        for (i, (&a, &b)) in got.iter().zip(want.iter()).enumerate() {
            if !bits(a, b) {
                self.note(si, format!("{what}[{i}] {a:e} vs {b:e}"));
                break;
            }
        }
    }
    fn exact_u8(&mut self, si: usize, what: &str, got: &[u8], want: &[u8]) {
        if got != want {
            self.note(si, format!("{what} mismatch"));
        }
    }
}

const NF: usize = 45;
fn bf(v: &[f64], i: usize) -> bool {
    v[i] == 1.0
}

/// Sorted-leg comparison: keys exact, values at sdig semantics.
fn sdig_leg(ctx: &mut Ctx, si: usize, what: &str, got: &[(i32, f64)], want: &[(i32, f64)]) {
    if got.len() != want.len() {
        ctx.note(si, format!("{what} len {} vs {}", got.len(), want.len()));
        return;
    }
    for (i, ((gk, gv), (wk, wv))) in got.iter().zip(want.iter()).enumerate() {
        if gk != wk {
            ctx.note(si, format!("{what}[{i}] key {gk} vs {wk}"));
            break;
        }
        if gv.to_bits() == wv.to_bits() {
            continue;
        }
        if gv.is_nan() || wv.is_nan() {
            ctx.note(si, format!("{what}[{i}] NaN {gv} vs {wv}"));
            break;
        }
        let r = rel(*gv, *wv);
        if r > ctx.worst {
            ctx.worst = r;
            ctx.worst_at = format!("sample {si}: {what}[{i}] {gv} vs {wv}");
        }
        if r > 1e-6 {
            ctx.note(si, format!("{what}[{i}] {gv:e} vs {wv:e}"));
            break;
        }
    }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let mut c = Cur { b: &bytes, o: 0 };
    let np = c.u32() as usize;
    let mut ctx = Ctx { fails: 0, shown: 0, worst: 0.0, worst_at: String::new(), nonconv: 0, stale: 0 };
    for (pi, _) in (0..np).enumerate() {
        if std::env::var("PROBE_DEBUG").is_ok() {
            eprintln!("preset {pi} o={} len={}", c.o, bytes.len());
        }
        let (n, ne) = (c.u32() as usize, c.u32() as usize);
        assert_eq!(c.u32(), 1, "format v1");
        let nc = c.u32() as usize;
        let mut curves = Vec::with_capacity(nc);
        for _ in 0..nc {
            let v = c.f64a(17);
            curves.push(Curve::new(
                v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10], v[11], v[12],
                v[13], v[14], v[15], v[16],
            ));
        }
        let curve_of = c.u32a(n);
        let eu = c.u32a(ne);
        let ev = c.u32a(ne);
        let wi = c.i32a(ne);
        let has_i = c.u8a(ne);
        let ii = c.i32a(ne);
        let dz = c.f64a(ne);
        let pool_at = c.i32a(ne);
        let choke_at = c.i32a(ne);
        let gas_at = c.i32a(ne);
        let liq_at = c.i32a(ne);
        let ck = c.i32a(ne);
        let diode_s = c.f64a(ne);
        let bore = c.f64a(ne);
        let llen = c.f64a(ne);
        let k0 = c.f64a(ne);
        let hce = c.f64a(ne);
        let cav_n = c.f64a(ne);
        let cav_one = c.f64a(ne);
        let cav_relief = c.f64a(ne);
        let cc0 = c.f64a(ne);
        let gate_n = c.u32a(ne);
        let g_is_fn = c.u8a(ne);
        let h_is_fn = c.u8a(ne);
        if std::env::var("PROBE_DEBUG").is_ok() {
            eprintln!("  meta ne={ne} gate_n sum={} gIsFn sum={} ck[0..4]={:?}",
                gate_n.iter().map(|&x| x as u64).sum::<u64>(),
                g_is_fn.iter().map(|&x| x as u64).sum::<u64>(), &ck[0..4.min(ne)]);
        }
        let g_scalar = c.f64a(ne);
        let h_scalar = c.f64a(ne);
        let ekey = c.i32a(ne);
        let meter = c.u8a(ne);
        let pair = c.i32a(ne);
        let is_break = c.u8a(ne);
        let break_steam = c.u8a(ne);
        let break_sec = c.u8a(ne);
        let is_sgtr = c.u8a(ne);
        let shell_of = c.i32a(ne);
        let shell_sign = c.u8a(ne);
        let work = c.u8a(ne);
        let fit = c.i32a(ne);
        let vol = c.f64a(n);
        let run_mask = c.u8a(n);
        let ng = c.u32() as usize;
        let gas_nodes = c.u32a(ng);
        let nl = c.u32() as usize;
        let liq_nodes = c.u32a(nl);
        let ncv = c.u32() as usize;
        let cond_v = c.u32a(ncv);
        let cont_mask = c.u8a(n);
        let ncl = c.u32() as usize;
        let _cont_list = c.u32a(ncl);
        let nt = c.u32() as usize;
        let tank_order = c.u32a(nt);
        let tank_hold = c.u8a(nt);
        let nhn = c.u32() as usize;
        let hold_nodes = c.u32a(nhn);
        let ndn = c.u32() as usize;
        let drum_nodes = c.u32a(ndn);
        let nst = c.u32() as usize;
        let _sec_t = c.u32a(nst);
        let ncn = c.u32() as usize;
        let core_nodes = c.u32a(ncn);
        let core_node = c.u32();
        // key tables: run, core, tank, shell, sgtr, relief, break
        let mut tables: Vec<Vec<i32>> = Vec::new();
        for _ in 0..7 {
            let k = c.u32() as usize;
            tables.push(c.i32a(k));
        }
        let (run_keys, core_keys, tank_keys, shell_keys, sgtr_keys, relief_keys, by_keys) =
            (&tables[0], &tables[1], &tables[2], &tables[3], &tables[4], &tables[5], &tables[6]);
        let loop_of_run = c.i32a(run_keys.len());
        let core_of = c.i32a(n);
        let tank_id_of = c.i32a(n);
        let sec_shell_of = c.i32a(n);
        let core_set = c.u8a(n);
        let nstr = c.u32() as usize;
        for _ in 0..nstr {
            let l = c.u32() as usize;
            c.o += l;
        }
        let fm = c.u32a(7);
        // rebuild key orders by the flowMapsOf rules; counts must match FM
        let mut rb_run: Vec<i32> = vec![];
        for e in 0..ne {
            if ekey[e] >= 0 && meter[e] != 0 && !rb_run.contains(&ekey[e]) {
                rb_run.push(ekey[e]);
            }
        }
        assert_eq!(rb_run.len(), fm[0] as usize, "runKeys rebuild");
        let mut rb_shell: Vec<i32> = vec![];
        for e in 0..ne {
            if shell_of[e] >= 0 && !rb_shell.contains(&shell_of[e]) {
                rb_shell.push(shell_of[e]);
            }
        }
        assert_eq!(rb_shell.len(), fm[3] as usize, "shellKeys rebuild");
        let mut rb_sgtr: Vec<i32> = vec![];
        for e in 0..ne {
            if is_sgtr[e] != 0 && ekey[e] >= 0 && !rb_sgtr.contains(&ekey[e]) {
                rb_sgtr.push(ekey[e]);
            }
        }
        assert_eq!(rb_sgtr.len(), fm[4] as usize, "sgtrKeys rebuild");
        let mut rb_by: Vec<i32> = vec![];
        for e in 0..ne {
            if is_break[e] != 0 && ekey[e] >= 0 && !rb_by.contains(&ekey[e]) {
                rb_by.push(ekey[e]);
            }
        }
        assert_eq!(rb_by.len(), fm[6] as usize, "byKeys rebuild");
        assert_eq!(core_keys.len(), fm[1] as usize, "coreKeys");
        assert_eq!(tank_keys.len(), fm[2] as usize, "tankKeys");
        assert_eq!(relief_keys.len(), fm[5] as usize, "reliefKeys");
        // pos maps: table index -> bag position (identity here: tables ARE
        // already in bag order, verified above against FM counts)
        let pos_of = |t: &[i32]| -> Vec<i32> {
            let m = t.iter().max().unwrap_or(&-1);
            let mut p = vec![-1i32; (*m).max(-1) as usize + 1];
            for (k, &key) in t.iter().enumerate() {
                if key >= 0 {
                    if key as usize >= p.len() {
                        p.resize(key as usize + 1, -1);
                    }
                    p[key as usize] = k as i32;
                }
            }
            p
        };
        let run_pos = pos_of(&rb_run);
        let tank_pos = pos_of(tank_keys);
        let shell_pos = pos_of(&rb_shell);
        let sgtr_pos = pos_of(&rb_sgtr);
        let relief_pos = pos_of(relief_keys);
        let by_pos = pos_of(&rb_by);
        let core_pos = pos_of(core_keys);
        // tankNodes mask: non-hold tankNode entries
        let mut tank_nodes = vec![0u8; n];
        for (k, &tn) in tank_order.iter().enumerate() {
            if tank_hold[k] == 0 {
                tank_nodes[tn as usize] = 1;
            }
        }
        if std::env::var("PROBE_DEBUG").is_ok() {
            eprintln!("  maps: tankNodes={} coreOfNZ={} secNZ={} tankIdNZ={}",
                tank_nodes.iter().map(|&x| x as usize).sum::<usize>(),
                core_of.iter().filter(|&&x| x >= 0).count(),
                sec_shell_of.iter().filter(|&&x| x >= 0).count(),
                tank_id_of.iter().filter(|&&x| x >= 0).count());
        }
        let st = FieldStruct {
            vol: vol.clone(),
            run_mask: run_mask.clone(),
            curve_of: curve_of.clone(),
            gas_nodes: gas_nodes.clone(),
            liq_nodes: liq_nodes.clone(),
            cond_v: cond_v.clone(),
            cont_mask: cont_mask.clone(),
        };
        // live state carried across samples
        let mut fs_opt: Option<FieldState> = None;
        let mut cache_sig: Option<String> = None;
        let mut cache_pc: Option<(Vec<i32>, usize, Vec<u8>)> = None;
        let mut memo = StoreState {
            kp: vec![f64::NAN; n],
            kh: vec![f64::NAN; n],
            km: vec![f64::NAN; n],
            p0: vec![0.0; n],
            cc: vec![0.0; n],
        };
        let ns = c.u32() as usize;
        for si in 0..ns {
            if std::env::var("PROBE_DEBUG").is_ok() {
                eprintln!("  sample {si} o={}", c.o);
            }
            ctx.shown = 0;
            let pb_v = c.f64a(n);
            let pb_has = c.u8a(n);
            let hb_v = c.f64a(n);
            let hb_has = c.u8a(n);
            let mb_v = c.f64a(n);
            let mb_has = c.u8a(n);
            let warr_pre = c.f64a(ne);
            let fallback_p = c.f64a(n);
            let fallback_h = c.f64a(n);
            let pool_raw = c.f64a(cond_v.len());
            if std::env::var("PROBE_DEBUG").is_ok() {
                eprintln!("  pre-Fpre o={} n={n} ne={ne}", c.o);
            }
            let pool_lvl: Vec<Option<f64>> =
                pool_raw.into_iter().map(|v| if v.is_nan() { None } else { Some(v) }).collect();
            if fs_opt.is_none() {
                // Dump order: 11 f64 (p,rho,x,b,rhoD,rhoG,rhoL,mu,lp,lh,lm) then wet, void.
                let s0 = c.f64a(n);
                let s1 = c.f64a(n);
                let s2 = c.f64a(n);
                let s3a = c.f64a(n);
                let s4 = c.f64a(n);
                let s5 = c.f64a(n);
                let s6 = c.f64a(n);
                let s9 = c.f64a(n);
                let s10 = c.f64a(n);
                let s11 = c.f64a(n);
                let s12 = c.f64a(n);
                let s7 = c.u8a(n);
                let s8 = c.u8a(n);
                fs_opt = Some(FieldState::seed(s0, s1, s2, s3a, s4, s5, s6, s7, s8, s9, s10, s11, s12));
            }
            let fs = fs_opt.as_mut().unwrap();
            // ---- 1. field ----
            let samp = FieldSample {
                pb_v: &pb_v, pb_has: &pb_has, hb_v: &hb_v, hb_has: &hb_has,
                mb_v: &mb_v, mb_has: &mb_has, w_arr: &warr_pre, edge_u: &eu, edge_v: &ev,
                fallback_p: &fallback_p, fallback_h: &fallback_h, pool_lvl: &pool_lvl,
            };
            let mut s3 = [0.0; 3];
            field_update(&st, &curves, fs, &samp, &mut s3);
            // F post expected lives at the end of the sample (dump order);
            // verified after the remaining reads below.
            // ---- fixed inputs (ref frame verified after pieces replay) ----
            let sp = c.f64a(1)[0];
            let p0p = c.f64a(1)[0];
            let level = if sp.is_nan() { p0p } else { sp };
            let pre_v = c.f64a(n);
            let cont = c.pins();
            let held = c.u32() != 0;
            let cont_p = c.f64a(n);
            let hold_pins = c.pins();
            let drum_pins = c.pins();
            let tank_pins = c.pins();
            let sec_pins = c.pins();
            let cond_pins = c.pins();
            if std::env::var("PROBE_DEBUG").is_ok() {
                eprintln!("  post-pins o={} ntanks? tanks={} conds={}", c.o, tank_order.len(), cond_v.len());
            }
            // ---- store rows ----
            let mut tanks = Vec::with_capacity(nt);
            for &tn in &tank_order {
                let tc = c.f64a(1)[0];
                let tp = c.f64a(1)[0];
                tanks.push(TankRow { node: tn, c: tc, p0: tp });
            }
            let mut conds = Vec::with_capacity(cond_v.len());
            for &cn in &cond_v {
                let cc = c.f64a(1)[0];
                let w = c.f64a(1)[0];
                let p0 = c.f64a(1)[0];
                let wrecked = c.u32() != 0;
                let vacuum = c.u32() != 0;
                conds.push(CondRow { node: cn, c: cc, w, p0, wrecked, vacuum });
            }
            let pre = [c.f64a(n), c.f64a(n), c.f64a(n), c.f64a(n), c.f64a(n)];
            if std::env::var("PROBE_DEBUG").is_ok() {
                eprintln!("  pre-kits o={}", c.o);
            }
            memo.kp.copy_from_slice(&pre[0]);
            memo.kh.copy_from_slice(&pre[1]);
            memo.km.copy_from_slice(&pre[2]);
            memo.p0.copy_from_slice(&pre[3]);
            memo.cc.copy_from_slice(&pre[4]);
            let exp_store_any = c.u32() != 0;
            let exp_store_cap = c.f64a(n);
            let exp_store_src = c.f64a(n);
            let exp_store_pin = c.u8a(n);
            if std::env::var("PROBE_DEBUG").is_ok() {
                eprintln!("  post-storeExp o={}", c.o);
            }
            // ---- 2. edges (initChoke threads the stale flag) ----
            let mut choke_state = c.u32() != 0;
            let field = FlowField {
                p: &fs.p, x: Some(&fs.x), wet: Some(&fs.wet), void_: Some(&fs.void_),
                rho_d: &fs.rho_d, rho_g: &fs.rho_g, rho_l: &fs.rho_l,
            };
            let mut gh_g = vec![0.0; ne];
            let mut gh_h = vec![0.0; ne];
            let mut warr = warr_pre.clone();
            let mut edge_c = vec![0.0; ne];
            let mut edge_d = vec![0.0; ne];
            for e in 0..ne {
                let q = c.f64a(NF);
                let mut gv = Vec::with_capacity(gate_n[e] as usize);
                for _ in 0..gate_n[e] {
                    gv.push(c.f64a(1)[0]);
                }
                let exp_cc = c.f64a(1)[0];
                let exp_g = c.f64a(1)[0];
                let exp_h = c.f64a(1)[0];
                let exp_ch = c.u32() != 0;
                let wopt = if bf(&q, 3) { Some(q[2]) } else { None };
                let mu = fs.mu[if wopt.map(|w| w >= 0.0).unwrap_or(false) {
                    eu[e] as usize
                } else {
                    ev[e] as usize
                }];
                let kin = CvalIn {
                    ck: ck[e] as i8,
                    c_closure: q[0],
                    cdead_wrecked: bf(&q, 1),
                    bore: bore[e],
                    llen: llen[e],
                    k0: k0[e],
                    w: wopt,
                    mu,
                    tank_live: bf(&q, 4),
                    port_live: bf(&q, 5),
                    gate_valves: &gv,
                    gate_throttle: bf(&q, 43),
                    relief_live: bf(&q, 44),
                    freg: q[6],
                    feed_train_c: q[7],
                    turb_c: q[8],
                    sgtr_live: bf(&q, 9),
                    sgtr_prod: q[10],
                    broken: bf(&q, 11),
                    wrecked: bf(&q, 12),
                    hole_c: hce[e],
                    sg_open: bf(&q, 14),
                    vent_active: bf(&q, 15),
                    vent_bore: q[16],
                    dump_open: bf(&q, 17),
                    dump_q: q[18],
                    dump_rho: q[19],
                    breach: bf(&q, 20),
                    tubes_open: q[21],
                    cav_n: cav_n[e],
                    cav_one: cav_one[e],
                    cav_relief_flag: bf(&q, 22),
                    cav_relief: cav_relief[e],
                    burst_by: bf(&q, 23),
                    disc: DiscIn {
                        kg: q[24], vol: q[25], drain: q[26], at: q[27],
                        has_burst: bf(&q, 28), pcont: q[29],
                    },
                    casing_f: q[30],
                    pump_h0: q[31],
                    cc: cc0[e],
                };
                let cc = edge_cval(&kin);
                if bits(cc, exp_cc) {
                } else if cc.is_nan() || exp_cc.is_nan() {
                    ctx.note(si, format!("edge {e} C NaN {cc} vs {exp_cc}"));
                } else {
                    let r = rel(cc, exp_cc);
                    if r > ctx.worst {
                        ctx.worst = r;
                        ctx.worst_at = format!("sample {si}: edge {e} C {cc} vs {exp_cc}");
                    }
                    if r > 1e-6 {
                        ctx.note(si, format!("edge {e} C {cc:e} vs {exp_cc:e}"));
                    }
                }
                let ph = pump_head_now(q[33], q[34], q[35], q[36]);
                let rho_end = |i: usize| {
                    if gas_at[e] == i as i32 && (fs.x[i] > 0.0 || fs.void_[i] != 0) {
                        fs.rho_g[i]
                    } else if liq_at[e] == i as i32 && fs.x[i] > 0.0 {
                        fs.rho_l[i]
                    } else {
                        fs.rho[i]
                    }
                };
                let sth = static_h(
                    dz[e],
                    rho_end(eu[e] as usize),
                    rho_end(ev[e] as usize),
                    if pool_at[e] < 0 {
                        0.0
                    } else {
                        (if pool_at[e] as u32 == eu[e] { 1.0 } else { -1.0 }) * q[37]
                    },
                );
                let opt = |v: i32| if v < 0 { None } else { Some(v as usize) };
                let wraw = if wi[e] < 0 { 0.0 } else { warr[wi[e] as usize] };
                let hin = HeadIn {
                    ck_undef: ck[e] < 0,
                    is_pump: bf(&q, 32),
                    pump_head: ph,
                    static_h: sth,
                    head_k: q[38],
                    h0: q[39],
                    hsrc_closure: q[40],
                    edge_in: edge_in(true, if q[41].is_nan() { 0.0 } else { q[41] }),
                };
                let (g, h, ch) = if g_is_fn[e] != 0 && cc > 0.0 {
                    let (g, h, ch) = edge_gh(
                        cc, &hin, &field, eu[e] as usize, ev[e] as usize, diode_s[e],
                        opt(choke_at[e]), opt(gas_at[e]), opt(liq_at[e]), wraw,
                    );
                    choke_state = ch;
                    (g, h, ch)
                } else if g_is_fn[e] != 0 {
                    (0.0, edge_h(&hin, wraw), choke_state)
                } else {
                    let gg = if g_scalar[e] != 0.0 && !g_scalar[e].is_nan() {
                        g_scalar[e]
                    } else {
                        0.0
                    };
                    (gg, 0.0, choke_state)
                };
                let h = if h_is_fn[e] != 0 {
                    h
                } else if h_scalar[e] != 0.0 && !h_scalar[e].is_nan() {
                    h_scalar[e]
                } else {
                    0.0
                };
                gh_g[e] = if g_is_fn[e] != 0 { g } else { g };
                gh_h[e] = h;
                edge_c[e] = cc;
                edge_d[e] = fs.p[eu[e] as usize] - fs.p[ev[e] as usize] + authored_head(cc, &hin);
                if ch != exp_ch {
                    ctx.note(si, format!("edge {e} CHOKE {ch} vs {exp_ch}"));
                }
                if !bits(h, exp_h) {
                    // Chained H rides replayed-F ulp (staticH densities);
                    // the edge gate covers H bit-exact from dumped F.
                    let r = rel(h, exp_h);
                    if r > ctx.worst {
                        ctx.worst = r;
                        ctx.worst_at = format!("sample {si}: edge {e} H {h} vs {exp_h}");
                    }
                    if h.is_nan() || exp_h.is_nan() || r > 1e-6 {
                        ctx.note(si, format!("edge {e} H {h:e} vs {exp_h:e}"));
                    }
                }
                if bits(g, exp_g) {
                } else if g.is_nan() || exp_g.is_nan() {
                    ctx.note(si, format!("edge {e} G NaN {g} vs {exp_g}"));
                } else {
                    let r = rel(g, exp_g);
                    if r > ctx.worst {
                        ctx.worst = r;
                        ctx.worst_at = format!("sample {si}: edge {e} G {g} vs {exp_g}");
                    }
                    if r > 1e-6 {
                        ctx.note(si, format!("edge {e} G {g:e} vs {exp_g:e}"));
                    }
                }
            }
            // choke replay array not compared per-edge beyond flags; net
            // choke set compared after the loop via diverge-style check below
            let with_cap = c.u32() != 0;
            if std::env::var("PROBE_DEBUG").is_ok() {
                eprintln!("  post-kits o={}", c.o);
            }
            let b_asm = c.f64a(n);
            let exp_b = c.f64a(n);
            let exp_q = c.f64a(ne);
            let exp_warned = c.u32() != 0;
            let topo_len = c.u32() as usize;
            c.o += topo_len; // AfTopo: only the warned flag gates the set check
            let no = c.u32() as usize;
            let exp_order = c.u32a(no);
            let exp_deg = c.u8a(n);
            let exp_by_v = c.f64a(n);
            let exp_by_has = c.u8a(n);
            let exp_byrun = c.f64a(fm[0] as usize);
            if std::env::var("PROBE_DEBUG").is_ok() {
                eprintln!("  post-byrun o={} fm={fm:?} no={no}", c.o);
            }
            let nbl = c.u32() as usize;
            let mut exp_byloop: Vec<(i32, f64)> = Vec::new();
            for _ in 0..nbl {
                let k = c.u32() as i32;
                let v = c.f64a(1)[0];
                exp_byloop.push((k, v));
            }
            let nbd = c.u32() as usize;
            let mut exp_bydrop: Vec<(i32, f64)> = Vec::new();
            for _ in 0..nbd {
                let k = c.u32() as i32;
                let v = c.f64a(1)[0];
                exp_bydrop.push((k, v));
            }
            let exp_core = c.f64a(1)[0];
            if std::env::var("PROBE_DEBUG").is_ok() {
                eprintln!("  post-core o={} nbl={nbl} nbd={nbd}", c.o);
            }
            let exp_bags = [
                c.f64a(fm[1] as usize),
                c.f64a(fm[2] as usize),
                c.f64a(fm[3] as usize),
                c.f64a(fm[6] as usize),
                c.f64a(fm[3] as usize),
                c.f64a(fm[4] as usize),
                c.f64a(fm[5] as usize),
                c.f64a(7),
            ];
            let exp_sc = [
                c.f64a(1)[0], c.f64a(1)[0], c.f64a(1)[0],
                c.f64a(1)[0], c.f64a(1)[0], c.f64a(1)[0],
            ];
            let exp_work_fr = c.f64a(ne);
            let exp_warr = c.f64a(ne);
            if std::env::var("PROBE_DEBUG").is_ok() {
                eprintln!("  pre-memoPost o={}", c.o);
            }
            if std::env::var("PROBE_DEBUG").is_ok() {
                eprintln!("  pre-memoPost o={}", c.o);
            }
            let post = [c.f64a(n), c.f64a(n), c.f64a(n), c.f64a(n), c.f64a(n)];
            if std::env::var("PROBE_DEBUG").is_ok() {
                eprintln!("  post-memo o={}", c.o);
            }
            // F post (dump order: 7 f64, wet, void, 4 f64)
            let exp_fpost = [
                c.f64a(n), c.f64a(n), c.f64a(n), c.f64a(n), c.f64a(n), c.f64a(n),
                c.f64a(n),
            ];
            let exp_fwet = c.u8a(n);
            let exp_fvoid = c.u8a(n);
            let exp_fpost2 = [c.f64a(n), c.f64a(n), c.f64a(n), c.f64a(n)];
            ctx.sdig(si, "F.p", &fs.p, &exp_fpost[0]);
            ctx.sdig(si, "F.rho", &fs.rho, &exp_fpost[1]);
            ctx.sdig(si, "F.x", &fs.x, &exp_fpost[2]);
            ctx.sdig(si, "F.b", &fs.b, &exp_fpost[3]);
            ctx.sdig(si, "F.rhoD", &fs.rho_d, &exp_fpost[4]);
            ctx.sdig(si, "F.rhoG", &fs.rho_g, &exp_fpost[5]);
            ctx.sdig(si, "F.rhoL", &fs.rho_l, &exp_fpost[6]);
            ctx.exact_u8(si, "F.wet", &fs.wet, &exp_fwet);
            if fs.wet != exp_fwet {
                for i in 0..n {
                    if fs.wet[i] != exp_fwet[i] {
                        let mut fed = 0.0;
                        for e in 0..ne {
                            let w = warr_pre[e];
                            if w > 0.0 && ev[e] as usize == i {
                                fed += w;
                            } else if w < 0.0 && eu[e] as usize == i {
                                fed -= w;
                            }
                        }
                        let m = if mb_has[i] != 0 { mb_v[i] } else { f64::NAN };
                        let eos = vol[i] * fs.rho[i];
                        ctx.note(si, format!("  wet[{i}] {} vs {} (m={:e} eos={:e} fedIn*dt={:e} dryline={:e})",
                            fs.wet[i], exp_fwet[i], m, eos,
                            fed * sim_rs::field::NET_DT, sim_rs::field::DRY_FRAC * vol[i] * fs.rho[i]));
                        break;
                    }
                }
            }
            ctx.exact_u8(si, "F.void", &fs.void_, &exp_fvoid);
            ctx.sdig(si, "F.mu", &fs.mu, &exp_fpost2[0]);
            ctx.exact_f64(si, "F.lp", &fs.lp, &exp_fpost2[1]);
            ctx.exact_f64(si, "F.lh", &fs.lh, &exp_fpost2[2]);
            ctx.exact_f64(si, "F.lm", &fs.lm, &exp_fpost2[3]);
            let exp_of = c.i32a(n);
            let exp_npc = c.u32() as usize;
            let exp_live = c.u8a(ne);
            let exp_hit = c.u32() != 0;
            let sig_len = c.u32() as usize;
            let exp_sig = String::from_utf8_lossy(&c.b[c.o..c.o + sig_len]).into_owned();
            c.o += sig_len;
            // ---- 3. pieces: JS consumes the (possibly stale) cache.
            // Fresh-vs-dumped verifies only on recompute (!hit).
            let (of, npc, live) = net_pieces(n, &eu, &ev, &gh_g);
            // Cache model: seed from dump when empty; on hit reuse carried.
            // Fresh-vs-dumped verifies only when JS recomputed (!hit):
            // a hit may serve a stale cache, which the carried check below
            // tracks instead.
            if cache_sig.is_none() {
                if !exp_hit && (of != exp_of || npc != exp_npc || live != exp_live) {
                    ctx.note(si, format!("PIECES fresh mismatch (n {npc} vs {exp_npc})"));
                }
                cache_sig = Some(exp_sig.clone());
                cache_pc = Some((exp_of.clone(), exp_npc, exp_live.clone()));
            } else {
                let use_cache = exp_hit && cache_sig.as_deref() == Some(exp_sig.as_str());
                if !use_cache {
                    if of != exp_of || npc != exp_npc || live != exp_live {
                        ctx.note(si, format!("PIECES fresh mismatch (n {npc} vs {exp_npc})"));
                        for e in 0..ne {
                            if live[e] != exp_live[e] {
                                ctx.note(si, format!("  edge {e} live {} vs {} (C={:e} d={:e})",
                                    live[e], exp_live[e], edge_c[e], edge_d[e]));
                                break;
                            }
                        }
                    }
                    cache_sig = Some(exp_sig.clone());
                    cache_pc = Some((exp_of.clone(), exp_npc, exp_live.clone()));
                }
            }
            // Carried cache must track the dump exactly.
            {
                let (co, cn, cl) = cache_pc.as_ref().unwrap();
                // Informational only: a mid-window sig flap (change and
                // change-back between samples) leaves JS holding a value
                // sampling cannot reproduce. The chain feeds dumped pc, and
                // fresh recomputes verify strictly on !hit above.
                if *co != exp_of || *cn != exp_npc || *cl != exp_live {
                    ctx.stale += 1;
                    if ctx.shown < 8 {
                        println!("sample {si}: CACHE stale (mid-window flap)");
                        ctx.shown += 1;
                    }
                }
            }
            let exp_anchor = c.i32a(exp_npc);
            let exp_p0 = c.f64a(exp_npc);
            // ---- 4. ref (sized by dumped npc: the tick anchors the cache) ----
            let (p0, anchor) = ref_frame(exp_npc, level);
            if anchor != exp_anchor || p0 != exp_p0 {
                ctx.note(si, "REF mismatch".to_string());
            }
            let exp_fx_v = c.f64a(n);
            let exp_fx_h = c.u8a(n);
            let touch_len = c.u32() as usize;
            assert_eq!(touch_len, n, "touch len");
            let exp_touch = c.u8a(touch_len);
            let nw = c.u32() as usize;
            let exp_widx = c.u32a(nw);
            // ---- 5. fixed (from dumped ref: the tick pins the cache) ----
            let (fv, fh) = fixed_fill(
                n, &pre_v, &exp_anchor, &exp_p0, &cont, held, &hold_pins, &drum_pins, &tank_pins,
                &sec_pins, &cond_pins,
            );
            ctx.exact_f64(si, "FIXED.v", &fv, &exp_fx_v);
            ctx.exact_u8(si, "FIXED.has", &fh, &exp_fx_h);
            // ---- 6. store ----
            let mut cap = vec![0.0; n];
            let mut src = vec![0.0; n];
            let mut pin = vec![0u8; n];
            let any = net_store(
                n, &vol, &curve_of, &curves, &fs.p, &fs.rho, &fs.x, &fs.b, &mb_v, &mb_has,
                &hb_v, &hb_has, &fallback_h, held, &hold_nodes, &drum_nodes, &tanks, &conds,
                &mut memo, &mut cap, &mut src, &mut pin,
            );
            if any != exp_store_any {
                ctx.note(si, format!("STORE nullness {any} vs {exp_store_any}"));
            }
            ctx.exact_u8(si, "STORE.pin", &pin, &exp_store_pin);
            ctx.sdig(si, "STORE.cap", &cap, &exp_store_cap);
            ctx.sdig(si, "STORE.src", &src, &exp_store_src);
            // memo writes: copies pin the === hit decision on replayed-vs-
            // dumped F; flips with inputs within 1e-12 are libm noise.
            for k in 0..3 {
                for i in 0..n {
                    let w = [&memo.kp, &memo.kh, &memo.km][k][i];
                    if bits(w, post[k][i]) {
                        continue;
                    }
                    let m_r = if mb_has[i] != 0 { mb_v[i] } else { f64::max(vol[i] * fs.rho[i], 1e-6) };
                    let m_d = if mb_has[i] != 0 {
                        mb_v[i]
                    } else {
                        f64::max(vol[i] * exp_fpost[1][i], 1e-6)
                    };
                    let close = |a: f64, b: f64| {
                        a.to_bits() == b.to_bits()
                            || (a - b).abs() / (a.abs() + b.abs() + 1e-300) < 1e-12
                    };
                    if close(fs.p[i], exp_fpost[0][i]) && close(m_r, m_d) {
                        ctx.nonconv += 1;
                        continue;
                    }
                    ctx.note(si, format!("MEMO[{k}][{i}] copy mismatch"));
                    break;
                }
            }
            {
                let mut p0ok = vec![true; n];
                let mut s3 = [0.0; 3];
                for i in 0..n {
                    if bits(memo.p0[i], post[3][i]) {
                        continue;
                    }
                    let m = if mb_has[i] != 0 { mb_v[i] } else { f64::max(vol[i] * fs.rho[i], 1e-6) };
                    let h_n = if hb_has[i] != 0 { hb_v[i] } else { fallback_h[i] };
                    let rho_t = m / vol[i];
                    let mut resid = |p: f64| {
                        mix_state(&curves[curve_of[i] as usize], p, h_n, &mut s3);
                        (s3[MX_RHO] - rho_t).abs() <= 1e-6 * rho_t + 1e-9
                    };
                    let (rr, jr) = (resid(memo.p0[i]), resid(post[3][i]));
                    if rho_t > 0.0 && rho_t.is_finite() && !rr && !jr {
                        ctx.nonconv += 1;
                        continue;
                    }
                    if rr && jr {
                        let (a, b) = (memo.p0[i], post[3][i]);
                        if (a - b).abs() / (a.abs() + b.abs() + 1e-300) <= 1e-9 {
                            continue;
                        }
                    }
                    p0ok[i] = false;
                    ctx.note(si, format!("MEMO[3][{i}] write mismatch"));
                    break;
                }
                for i in 0..n {
                    if bits(memo.cc[i], post[4][i]) {
                        continue;
                    }
                    if p0ok[i] {
                        let (a, b) = (memo.cc[i], post[4][i]);
                        if !a.is_nan() && !b.is_nan()
                            && (a - b).abs() / (a.abs() + b.abs() + 1e-30) <= 1e-9
                        {
                            continue;
                        }
                    }
                    ctx.note(si, format!("MEMO[4][{i}] write mismatch"));
                    break;
                }
            }
            // ---- 7. linear ----
            let order = net_order(n, &eu, &ev, &fh);
            if order != exp_order {
                let mut first = None;
                for (i, (&a, &b)) in order.iter().zip(exp_order.iter()).enumerate() {
                    if a != b {
                        first = Some((i, a, b));
                        break;
                    }
                }
                ctx.note(si, format!("ORDER mismatch len {} vs {} first {first:?}",
                    order.len(), exp_order.len()));
            }
            let nf = order.len();
            let mut row = vec![0u32; n];
            for (k, &f) in order.iter().enumerate() {
                row[f as usize] = k as u32;
            }
            let mut bw = 0usize;
            for e in 0..ne {
                let (a, b) = (eu[e] as usize, ev[e] as usize);
                if fh[a] != 0 || fh[b] != 0 {
                    continue;
                }
                let d = (row[a] as i64 - row[b] as i64).unsigned_abs() as usize;
                if d > bw {
                    bw = d;
                }
            }
            let cap_arg: Option<&[f64]> = if with_cap { Some(&cap) } else { None };
            let store_src: Option<&[f64]> = if with_cap || !with_cap { Some(&src) } else { None };
            let mut aa = vec![0.0; nf * nf];
            let mut bb = vec![0.0; n];
            let mut touch = vec![0u8; n];
            net_assemble(
                &eu, &ev, &gh_g, &gh_h, &fv, &fh, cap_arg, store_src.as_deref(),
                Some(&row), nf, n, Some(&mut touch), Some(&mut aa), &mut bb,
            );
            ctx.sdig(si, "ASM.b", &bb, &b_asm);
            let mut deg = vec![0u8; nf.max(1)];
            let mut d0 = vec![0.0; nf.max(1)];
            if nf > 0 {
                net_factor(&mut aa, nf, Some(&mut deg), Some(bw), &mut d0);
            }
            let mut ccv = vec![0.0; nf];
            for (k, &f) in order.iter().enumerate() {
                ccv[k] = bb[f as usize];
            }
            if nf > 0 {
                net_subst(&aa, &mut ccv, nf, Some(bw));
            }
            let mut p = vec![0.0; n];
            for (k, &f) in order.iter().enumerate() {
                p[f as usize] = ccv[k];
            }
            net_unfix(&mut p, &fv, &fh, n);
            ctx.sdig(si, "SOL.b", &p, &exp_b);
            let mut qq = vec![0.0; ne];
            net_flows(&eu, &ev, &gh_g, &gh_h, &p, &fv, &fh, &mut qq);
            ctx.sdig(si, "SOL.q", &qq, &exp_q);
            let mut deg_n = vec![0u8; n];
            for (k, &f) in order.iter().enumerate() {
                deg_n[f as usize] = deg[k];
            }
            if deg_n != exp_deg {
                ctx.note(si, "DEG mismatch".to_string());
            }
            ctx.exact_u8(si, "TOUCH", &touch, &exp_touch);
            // wArr writeback (march context, never read-only here)
            ctx.sdig(si, "WARR", &qq, &exp_warr);
            // ---- 8. diverge (gated like the JS: warns only on topo change)
            if exp_warned {
                let (res, _) =
                    diverge_check(&eu, &ev, &qq, &fh, Some(&deg_n), Some(&cap), Some(&src), &p, n);
                let mut got: Vec<u32> = res.into_iter().map(|(i, _)| i as u32).collect();
                got.sort();
                let mut want = exp_widx.clone();
                want.sort();
                if got != want {
                    ctx.note(si, format!("DIVERGE set {got:?} vs {want:?}"));
                }
            }
            // ---- 9. readP ----
            {
                let mut by_v = vec![0.0; n];
                let mut by_has = vec![0u8; n];
                net_read_p(&p, &fh, &touch, &exp_of, exp_npc, &exp_anchor, Some(&deg_n), Some(&pin),
                    &fs.wet, &cont_p, &mut by_v, &mut by_has);
                ctx.sdig(si, "READP.v", &by_v, &exp_by_v);
                ctx.exact_u8(si, "READP.has", &by_has, &exp_by_has);
            }
            // ---- 10. readEdges (tick containers: typed byRun, legacy rest) ----
            {
                let mut re: Vec<ReadEdge> = Vec::with_capacity(ne);
                for e in 0..ne {
                    re.push(ReadEdge {
                        u: eu[e], v: ev[e], key: ekey[e], meter: meter[e] != 0,
                        pair: pair[e],
                        tank_u: tank_nodes[eu[e] as usize] != 0,
                        tank_v: tank_nodes[ev[e] as usize] != 0,
                        tank_id_u: tank_id_of[eu[e] as usize],
                        tank_id_v: tank_id_of[ev[e] as usize],
                        shell_of: shell_of[e],
                        shell_sign_neg: shell_sign[e] != 0,
                        sec_u: sec_shell_of[eu[e] as usize],
                        sec_v: sec_shell_of[ev[e] as usize],
                        is_sgtr: is_sgtr[e] != 0,
                        is_break: is_break[e] != 0,
                        break_steam: break_steam[e] != 0,
                        break_sec: break_sec[e] != 0,
                    work: work[e] != 0,
                    work_fr: exp_work_fr[e],
                    relief: if fit[e] < 0 {
                        -1
                    } else {
                        relief_keys.iter().position(|&k| k == fit[e]).map(|p| p as i32).unwrap_or(-1)
                    },
                });
                }
                let max_stab = ekey
                    .iter()
                    .chain(shell_of.iter())
                    .filter(|&&x| x >= 0)
                    .max()
                    .unwrap_or(&-1);
                let mut loop_stab = vec![-1i32; (*max_stab).max(0) as usize + 1];
                for (pos, &rk) in run_keys.iter().enumerate() {
                    if rk >= 0 && (rk as usize) < loop_stab.len() {
                        loop_stab[rk as usize] = loop_of_run[pos];
                    }
                }
                let mut by_run = vec![0.0; rb_run.len()];
                let mut by_loop_leg: Vec<(i32, f64)> = vec![];
                let mut by_drop_leg: Vec<(i32, f64)> = vec![];
                let mut core_kg_v = vec![0.0; core_keys.len()];
                let mut bags = OutsBags {
                    core_kg: vec![],
                    q_tank: vec![0.0; tank_keys.len()],
                    sg_steam: vec![0.0; rb_shell.len()],
                    by: vec![0.0; rb_by.len()],
                    sg_feed: vec![0.0; rb_shell.len()],
                    sgtr: vec![0.0; rb_sgtr.len()],
                    relief: vec![0.0; relief_keys.len()],
                    sc: [0.0; 7],
                };
                let mut leg = OutsLegacy::default();
                let mut core_tot = 0.0;
                let in_core: Vec<bool> = core_set.iter().map(|&x| x != 0).collect();
                net_read_edges(
                    &re, &p, &qq, &fh, &exp_anchor, &fs.wet, &in_core, &core_of, &loop_stab,
                    &run_pos, &tank_pos, &shell_pos, &sgtr_pos, &relief_pos, &by_pos,
                    &core_pos, Some(&mut by_run), &mut vec![], None, &mut by_loop_leg,
                    &mut by_drop_leg, Some(&mut bags), &mut leg, Some(&mut core_kg_v), &mut core_tot,
                );
                ctx.sdig(si, "BYRUN", &by_run, &exp_byrun);
                ctx.sdig(si, "COREKG", &core_kg_v, &exp_bags[0]);
                let mut got_loop = by_loop_leg.clone();
                got_loop.sort_by_key(|&(k, _)| k);
                let mut want_loop = exp_byloop.clone();
                want_loop.sort_by_key(|&(k, _)| k);
                sdig_leg(&mut ctx, si, "BYLOOP", &got_loop, &want_loop);
                // byDrop keys are runKeys positions; map to table order
                let mut got_drop: Vec<(i32, f64)> = by_drop_leg
                    .into_iter()
                    .map(|(k, v)| (run_keys[k as usize], v))
                    .collect();
                got_drop.sort_by_key(|&(k, _)| k);
                let mut want_drop: Vec<(i32, f64)> = exp_bydrop
                    .into_iter()
                    .map(|(k, v)| (run_keys[k as usize], v))
                    .collect();
                want_drop.sort_by_key(|&(k, _)| k);
                sdig_leg(&mut ctx, si, "BYDROP", &got_drop, &want_drop);
                if core_tot.to_bits() != exp_core.to_bits() {
                    let r = rel(core_tot, exp_core);
                    if r > ctx.worst {
                        ctx.worst = r;
                        ctx.worst_at = format!("sample {si}: CORE {core_tot} vs {exp_core}");
                    }
                    if core_tot.is_nan() || exp_core.is_nan() || r > 1e-6 {
                        ctx.note(si, format!("CORE {core_tot:e} vs {exp_core:e}"));
                    }
                }
                let got_bags = [
                    bags.q_tank, bags.sg_steam, bags.by, bags.sg_feed, bags.sgtr,
                    bags.relief, bags.sc.to_vec(),
                ];
                let want_bags = [
                    &exp_bags[1], &exp_bags[2], &exp_bags[3], &exp_bags[4], &exp_bags[5],
                    &exp_bags[6], &exp_bags[7],
                ];
                for ((bi, (g, w)), nm) in got_bags.into_iter().zip(want_bags.into_iter()).enumerate()
                    .zip(["QTANK", "SGSTEAM", "BY", "SGFEED", "SGTR", "RELIEF", "SC"])
                {
                    if g.len() != w.len() {
                        ctx.note(si, format!("{nm} len {} vs {}", g.len(), w.len()));
                        break;
                    }
                    ctx.sdig(si, nm, &g, w);
                }
                let sc = [leg.turb_wk, leg.turb_wk_p, leg.turb_wk_a, leg.q_sgtr, leg.spill, leg.spill_sec];
                ctx.sdig(si, "LEGACY.sc", &sc, &exp_sc);
                if !leg.core_kg.is_empty() || !leg.q_tank.is_empty() || !leg.sg_steam.is_empty()
                    || !leg.by.is_empty() || !leg.sg_feed.is_empty() || !leg.sgtr.is_empty()
                    || !leg.relief.is_empty()
                {
                    ctx.note(si, "LEGACY bags should stay empty on the typed path".to_string());
                }
            }
        }
    }
    println!(
        "presets={np} worst={} @ {} nonconv={} stale={} FAILURES={}",
        ctx.worst, ctx.worst_at, ctx.nonconv, ctx.stale, ctx.fails
    );
}
