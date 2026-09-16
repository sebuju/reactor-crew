//! Edge-term replayer for the §6.2f gate (`node tools/edge-gate.js`).
//! Replays edge_cval/edge_gh per edge and demands exact choke agreement,
//! exact h, and sdig-semantics C/g. Dev-only.
use sim_rs::edge::{edge_in, *};
use sim_rs::hydro::FlowField;

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
}

const NF: usize = 45;
// kit floats per edge:
// 0 Cclosure, 1 CdeadW, 2 w, 3 hasW, 4 tankLive, 5 portLive, 6 freg, 7 feedTrainC,
// 8 turbC, 9 sgtrLive, 10 sgtrProd, 11 broken, 12 wrecked, 13 holeC, 14 sgOpen,
// 15 ventActive, 16 ventBore, 17 dumpOpen, 18 dumpQ, 19 dumpRho, 20 breach,
// 21 tubesOpen, 22 cavReliefFlag, 23 burstBy,
// 24 discKg, 25 discVol, 26 discDrain, 27 discAt, 28 discHas, 29 discPcont,
// 30 casingF, 31 pumpH0, 32 isPump, 33 pumpHead, 34 pumpDrive, 35 pumpCav, 36 pumpRhoK,
// 37 poolTerm, 38 headK, 39 h0, 40 hSrcClosure, 41 edgeInert, 42 diode,
// 43 gateThrottle, 44 reliefLive
fn b(v: &[f64], i: usize) -> bool {
    // Driver writes 1/0 for evaluated flags, NaN for unevaluated slots:
    // only an explicit 1 is true.
    v[i] == 1.0
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let mut c = Cur { b: &bytes, o: 0 };
    let np = c.u32() as usize;
    let mut fails = 0;
    let mut worst_c = 0.0;
    let mut worst_g = 0.0;
    let mut worst_at = String::new();
    for _ in 0..np {
        let (n, ne) = (c.u32() as usize, c.u32() as usize);
        assert_eq!(c.u32(), 1, "format v1");
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
        let hc = c.f64a(ne);
        let cav_n = c.f64a(ne);
        let cav_one = c.f64a(ne);
        let cav_relief = c.f64a(ne);
        let cc0 = c.f64a(ne);
        let gate_n = c.u32a(ne);
        let g_is_fn = c.u8a(ne);
        let h_is_fn = c.u8a(ne);
        let g_scalar = c.f64a(ne);
        let h_scalar = c.f64a(ne);
        let ns = c.u32() as usize;
        for si in 0..ns {
            let fp = c.f64a(n);
            let fx = c.f64a(n);
            let frho = c.f64a(n);
            let frhod = c.f64a(n);
            let frhog = c.f64a(n);
            let frhol = c.f64a(n);
            let fmu = c.f64a(n);
            let fwet = c.u8a(n);
            let fvoid = c.u8a(n);
            let warr = c.f64a(ne);
            let init_choke = c.u32() != 0;
            let field = FlowField {
                p: &fp, x: Some(&fx), wet: Some(&fwet), void_: Some(&fvoid),
                rho_d: &frhod, rho_g: &frhog, rho_l: &frhol,
            };
            let ch_present = c.u32() != 0;
            let ch_len = if ch_present { c.u32() as usize } else { 0 };
            let ch_dump = if ch_present { c.f64a(ch_len) } else { vec![] };
            let mut ch_rep = if ch_present { vec![0.0; ch_dump.len()] } else { vec![] };
            // FLOWG_CHOKE threads edge-to-edge: flowG sets it only when
            // C>0, otherwise the stale flag persists (seeded from the dump).
            let mut choke_state = init_choke;
            let mut shown = 0;
            for e in 0..ne {
                let q = c.f64a(NF);
                let mut gv = Vec::with_capacity(gate_n[e] as usize);
                for _ in 0..gate_n[e] {
                    let v = f64::from_le_bytes([
                        c.b[c.o], c.b[c.o + 1], c.b[c.o + 2], c.b[c.o + 3],
                        c.b[c.o + 4], c.b[c.o + 5], c.b[c.o + 6], c.b[c.o + 7],
                    ]);
                    c.o += 8;
                    gv.push(v);
                }
                let exp_cc = c.f64a(1)[0];
                let exp_g = c.f64a(1)[0];
                let exp_h = c.f64a(1)[0];
                let exp_ch = c.u32() != 0;
                let wopt = if b(&q, 3) { Some(q[2]) } else { None };
                let mu = fmu[if wopt.map(|w| w >= 0.0).unwrap_or(false) {
                    eu[e] as usize
                } else {
                    ev[e] as usize
                }];
                let kin = CvalIn {
                    ck: ck[e] as i8,
                    c_closure: q[0],
                    cdead_wrecked: b(&q, 1),
                    bore: bore[e],
                    llen: llen[e],
                    k0: k0[e],
                    w: wopt,
                    mu,
                    tank_live: b(&q, 4),
                    port_live: b(&q, 5),
                    gate_valves: &gv,
                    gate_throttle: b(&q, 43),
                    relief_live: b(&q, 44),
                    freg: q[6],
                    feed_train_c: q[7],
                    turb_c: q[8],
                    sgtr_live: b(&q, 9),
                    sgtr_prod: q[10],
                    broken: b(&q, 11),
                    wrecked: b(&q, 12),
                    hole_c: hc[e],
                    sg_open: b(&q, 14),
                    vent_active: b(&q, 15),
                    vent_bore: q[16],
                    dump_open: b(&q, 17),
                    dump_q: q[18],
                    dump_rho: q[19],
                    breach: b(&q, 20),
                    tubes_open: q[21],
                    cav_n: cav_n[e],
                    cav_one: cav_one[e],
                    cav_relief_flag: b(&q, 22),
                    cav_relief: cav_relief[e],
                    burst_by: b(&q, 23),
                    disc: DiscIn {
                        kg: q[24], vol: q[25], drain: q[26], at: q[27],
                        has_burst: b(&q, 28), pcont: q[29],
                    },
                    casing_f: q[30],
                    pump_h0: q[31],
                    cc: cc0[e],
                };
                let cc = edge_cval(&kin);
                // pump/static algebra chained from dumped scalars
                let ph = pump_head_now(q[33], q[34], q[35], q[36]);
                // rhoEndOf: gas/liquid ends read F.rhoG/F.rhoL, else the
                // MEAN F.rho (never the donor F.rhoD flowG reads).
                let rho_end = |i: usize| {
                    if gas_at[e] == i as i32 && (fx[i] > 0.0 || fvoid[i] != 0) {
                        frhog[i]
                    } else if liq_at[e] == i as i32 && fx[i] > 0.0 {
                        frhol[i]
                    } else {
                        frho[i]
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
                    is_pump: b(&q, 32),
                    pump_head: ph,
                    static_h: sth,
                    head_k: q[38],
                    h0: q[39],
                    hsrc_closure: q[40],
                    // `(ed.I || 0)`: missing inertance reads 0, never NaN.
                    edge_in: edge_in(true, if q[41].is_nan() { 0.0 } else { q[41] }),
                };
                let (g, mut h, ch) = if g_is_fn[e] != 0 && cc > 0.0 {
                    let (g, h, ch) = edge_gh(
                        cc, &hin, &field, eu[e] as usize, ev[e] as usize, diode_s[e],
                        opt(choke_at[e]), opt(gas_at[e]), opt(liq_at[e]), wraw,
                    );
                    choke_state = ch;
                    (g, h, ch)
                } else if g_is_fn[e] != 0 {
                    // C<=0: flowG never runs, the flag persists untouched.
                    (0.0, edge_h(&hin, wraw), choke_state)
                } else {
                    let gg = if g_scalar[e] != 0.0 && !g_scalar[e].is_nan() {
                        g_scalar[e]
                    } else {
                        0.0
                    };
                    (gg, 0.0, choke_state)
                };
                // h rides separately: numeric h passes through untouched.
                h = if h_is_fn[e] != 0 { h } else if h_scalar[e] != 0.0 && !h_scalar[e].is_nan() {
                    h_scalar[e]
                } else {
                    0.0
                };
                if has_i[e] != 0 && ch_present {
                    ch_rep[ii[e] as usize] = if g > 0.0 && ch { 1.0 } else { 0.0 };
                }
                let rel = |a: f64, b: f64| (a - b).abs() / (a.abs() + b.abs() + 1e-30);
                // note(msg): fails += 1, printing the first 5 per sample.
                macro_rules! note {
                    ($msg:expr) => {{
                        fails += 1;
                        if shown < 5 {
                            println!("sample {si}: {}", $msg);
                            shown += 1;
                        }
                    }};
                }
                if ch != exp_ch {
                    note!(format!("edge {e} CHOKE {ch} vs {exp_ch}"));
                }
                if h.to_bits() != exp_h.to_bits() {
                    if std::env::var("PROBE_DEBUG").is_ok() && fails == 0 {
                        let ru = rho_end(eu[e] as usize);
                        let rv = rho_end(ev[e] as usize);
                        println!("sample {si}: edge {e} H {h:e} vs {exp_h:e}");
                        println!(
                            "  HDBG ru={} rv={} dz={} pool={} edgeIn={} w={} headK={} static={}",
                            ru, rv, dz[e],
                            if pool_at[e] < 0 { 0.0 } else { (if pool_at[e] as u32 == eu[e] { 1.0 } else { -1.0 }) * q[37] },
                            hin.edge_in, wraw, hin.head_k, sth
                        );
                    }
                    note!(format!("edge {e} H {h:e} vs {exp_h:e}"));
                }
                for (nm, a, e2, w) in [("C", cc, exp_cc, &mut worst_c), ("G", g, exp_g, &mut worst_g)] {
                    if a.to_bits() == e2.to_bits() {
                        continue;
                    }
                    if a.is_nan() || e2.is_nan() {
                        note!(format!("edge {e} {nm} NaN {a} vs {e2}"));
                        continue;
                    }
                    let r = rel(a, e2);
                    if r > *w {
                        *w = r;
                        worst_at = format!("sample {si}: edge {e} {nm} {a} vs {e2}");
                    }
                    if r > 1e-6 {
                        note!(format!("edge {e} {nm} {a:e} vs {e2:e}"));
                    }
                }
            }
            if ch_present && ch_rep != ch_dump {
                fails += 1;
                println!("sample {si}: NET.CHOKE mismatch");
            }
        }
    }
    println!("presets={np} worst-C={worst_c:e} worst-G={worst_g:e} @ {worst_at} FAILURES={fails}");
}
