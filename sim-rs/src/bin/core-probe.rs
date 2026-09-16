//! Core replayer for the §6.4 gate (`node tools/core-gate.js`).
//! Replays per-vessel samples: TICK (rod→decay→fatigue→burst→coreStep→
//! vessel-tail→kinetics→melt in tick order), NOD (synthetic `coreStep` arg
//! sets), KIN (synthetic rho), ROD (synthetic scram/split). Masks/counts/
//! strings exact, floats at sdig semantics. Dev-only.
use sim_rs::core::*;
use sim_rs::eos::{js_min, Curve};

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
    fn u8a(&mut self, n: usize) -> Vec<u8> {
        let v = self.b[self.o..self.o + n].to_vec();
        self.o += n;
        v
    }
    fn strb(&mut self) -> String {
        let n = self.u32() as usize;
        let v = self.b[self.o..self.o + n].to_vec();
        self.o += n;
        String::from_utf8_lossy(&v).into_owned()
    }
}

fn bits(a: f64, b: f64) -> bool {
    a.to_bits() == b.to_bits()
}

struct Cmp {
    fails: u32,
    worst: f64,
    worst_at: String,
    shown: u32,
}

impl Cmp {
    fn floats(&mut self, tag: &str, si: usize, nm: &str, got: &[f64], want: &[f64]) {
        for (i, (&a, &b)) in got.iter().zip(want.iter()).enumerate() {
            if bits(a, b) || (a.is_nan() && b.is_nan()) {
                continue;
            }
            let r = (a - b).abs() / (a.abs() + b.abs() + 1e-30);
            if r > self.worst {
                self.worst = r;
                self.worst_at = format!("{tag} sample {si}: {nm}[{i}] {a} vs {b}");
            }
            if r > 1e-6 {
                self.fails += 1;
                if self.shown < 8 {
                    println!("{tag} sample {si}: {nm}[{i}] {a:e} vs {b:e} (rel {r:e})");
                    self.shown += 1;
                }
                break;
            }
        }
    }
    fn float1(&mut self, tag: &str, si: usize, nm: &str, a: f64, b: f64) {
        if bits(a, b) || (a.is_nan() && b.is_nan()) {
            return;
        }
        let r = (a - b).abs() / (a.abs() + b.abs() + 1e-30);
        if r > self.worst {
            self.worst = r;
            self.worst_at = format!("{tag} sample {si}: {nm} {a} vs {b}");
        }
        if r > 1e-6 {
            self.fails += 1;
            if self.shown < 8 {
                println!("{tag} sample {si}: {nm} {a:e} vs {b:e} (rel {r:e})");
                self.shown += 1;
            }
        }
    }
    fn ints(&mut self, tag: &str, si: usize, nm: &str, got: &[u8], want: &[u8]) {
        if got != want {
            self.fails += 1;
            let bad: Vec<usize> =
                got.iter().zip(want.iter()).enumerate().filter(|(_, (&a, &b))| a != b).map(|(i, _)| i).take(5).collect();
            println!("{tag} sample {si}: {nm} mask mismatch at {bad:?}");
        }
    }
    fn exact_f64(&mut self, tag: &str, si: usize, nm: &str, got: &[f64], want: &[f64]) {
        for (i, (&a, &b)) in got.iter().zip(want.iter()).enumerate() {
            if bits(a, b) || (a.is_nan() && b.is_nan()) {
                continue;
            }
            self.fails += 1;
            println!("{tag} sample {si}: {nm}[{i}] EXACT {a:e} vs {b:e}");
            break;
        }
    }
}

fn read_cs(c: &mut Cur, nb: usize) -> CoreState {
    let mut cs = CoreState::default();
    let arr = |c: &mut Cur| c.f64a(XNN);
    cs.phi = arr(c);
    cs.x_i = arr(c);
    cs.x_x = arr(c);
    cs.n_tf = arr(c);
    cs.n_tc = arr(c);
    cs.n_v = arr(c);
    cs.n_rho = arr(c);
    cs.n_vt = arr(c);
    cs.n_tct = arr(c);
    cs.n_cov = arr(c);
    cs.n_fol = arr(c);
    cs.n_dmg = arr(c);
    cs.n_ox = arr(c);
    cs.n_melt = arr(c);
    cs.n_disp = arr(c);
    cs.n_dnb = arr(c);
    cs.ch_w = c.f64a(XNR);
    cs.n = c.f64a(1)[0];
    cs.c = c.f64a(6);
    cs.dec = c.f64a(4);
    cs.decay = c.f64a(1)[0];
    cs.heat = c.f64a(1)[0];
    cs.rod_pos = c.f64a(1)[0];
    cs.rod_dem = c.f64a(1)[0];
    cs.rod_z = c.f64a(nb);
    cs.rod_zdem = c.f64a(nb);
    cs.tilt = c.f64a(1)[0];
    cs.tilt_dem = c.f64a(1)[0];
    let f = c.u8a(5);
    cs.split = f[0] != 0;
    cs.re_gang = f[1] != 0;
    cs.rod_jam = f[2] != 0;
    cs.scrammed = f[3] != 0;
    cs.rod_band = f[4] != 0;
    let s14 = c.f64a(14);
    cs.ao = s14[0];
    cs.ro = s14[1];
    cs.hot_ring = s14[2];
    cs.hot_lev = s14[3];
    cs.v_node = s14[4];
    cs.hot_flow = s14[5];
    cs.tip_rho_out = s14[6];
    cs.tf_hot = s14[7];
    cs.dmg = s14[8];
    cs.melt_frac = s14[9];
    cs.ox_max = s14[10];
    cs.q_ox = s14[11];
    cs.fci = s14[12];
    cs.t_clad_hot = s14[13];
    let s8 = c.f64a(8);
    cs.dnbr_min = s8[0];
    cs.dnbr_ring = s8[1];
    cs.dnbr_lev = s8[2];
    cs.fq = s8[3];
    cs.vf = s8[4];
    cs.void_th = s8[5];
    cs.core_dt = s8[6];
    cs.dnbr = s8[7];
    let s9 = c.f64a(9);
    cs.x = s9[0];
    cs.i = s9[1];
    cs.tf = s9[2];
    cs.parts = [s9[3], s9[4], s9[5], s9[6], s9[7], s9[8], 0.0, 0.0, 0.0];
    let p2 = c.f64a(3);
    cs.parts[6] = p2[0];
    cs.parts[7] = p2[1];
    cs.parts[8] = p2[2];
    let s4 = c.f64a(4);
    cs.rho = s4[0];
    cs.p_core = s4[1];
    cs.flow_net = s4[2];
    cs.fatigue = s4[3];
    let m = c.u8a(2);
    cs.melt = m[0] != 0;
    cs.breach = m[1] != 0;
    cs
}

fn cmp_cs(cmp: &mut Cmp, tag: &str, si: usize, got: &CoreState, want: &CoreState, nb: usize) {
    let nodal = [
        ("phi", &got.phi, &want.phi), ("xI", &got.x_i, &want.x_i), ("xX", &got.x_x, &want.x_x),
        ("nTf", &got.n_tf, &want.n_tf), ("nTc", &got.n_tc, &want.n_tc), ("nV", &got.n_v, &want.n_v),
        ("nRho", &got.n_rho, &want.n_rho), ("nVt", &got.n_vt, &want.n_vt),
        ("nTct", &got.n_tct, &want.n_tct), ("nCov", &got.n_cov, &want.n_cov),
        ("nFol", &got.n_fol, &want.n_fol), ("nDmg", &got.n_dmg, &want.n_dmg),
        ("nOx", &got.n_ox, &want.n_ox), ("nMelt", &got.n_melt, &want.n_melt),
        ("nDisp", &got.n_disp, &want.n_disp),
    ];
    for (nm, g, w) in nodal {
        cmp.floats(tag, si, nm, g, w);
    }
    cmp.exact_f64(tag, si, "nDnb", &got.n_dnb, &want.n_dnb);
    cmp.floats(tag, si, "chW", &got.ch_w, &want.ch_w);
    cmp.floats(tag, si, "C", &got.c, &want.c);
    cmp.floats(tag, si, "dec", &got.dec, &want.dec);
    let sgot = [
        got.n, got.decay, got.heat, got.rod_pos, got.rod_dem, got.tilt, got.tilt_dem, got.ao,
        got.ro, got.hot_ring, got.hot_lev, got.v_node, got.hot_flow, got.tip_rho_out, got.tf_hot,
        got.dmg, got.melt_frac, got.ox_max, got.q_ox, got.fci, got.t_clad_hot, got.dnbr_min,
        got.fq, got.vf, got.void_th, got.core_dt, got.dnbr, got.x, got.i, got.tf, got.rho,
        got.p_core, got.flow_net, got.fatigue,
    ];
    let swant = [
        want.n, want.decay, want.heat, want.rod_pos, want.rod_dem, want.tilt, want.tilt_dem, want.ao,
        want.ro, want.hot_ring, want.hot_lev, want.v_node, want.hot_flow, want.tip_rho_out, want.tf_hot,
        want.dmg, want.melt_frac, want.ox_max, want.q_ox, want.fci, want.t_clad_hot, want.dnbr_min,
        want.fq, want.vf, want.void_th, want.core_dt, want.dnbr, want.x, want.i, want.tf, want.rho,
        want.p_core, want.flow_net, want.fatigue,
    ];
    // Integer-valued ring/level reads compare exact.
    for (idx, nm) in [(9, "hotRing"), (10, "hotLev")] {
        if sgot[idx].to_bits() != swant[idx].to_bits()
            && !(sgot[idx].is_nan() && swant[idx].is_nan())
        {
            cmp.fails += 1;
            println!("{tag} sample {si}: {nm} EXACT {} vs {}", sgot[idx], swant[idx]);
        }
    }
    let skip = [9usize, 10];
    for (i, (&a, &b)) in sgot.iter().zip(swant.iter()).enumerate() {
        if skip.contains(&i) {
            continue;
        }
        cmp.float1(tag, si, &format!("cs[{i}]"), a, b);
    }
    cmp.floats(tag, si, "rodZ", &got.rod_z[..nb.min(got.rod_z.len())], &want.rod_z[..nb.min(want.rod_z.len())]);
    cmp.floats(tag, si, "rodZDem", &got.rod_zdem, &want.rod_zdem);
    cmp.floats(tag, si, "parts", &got.parts, &want.parts);
    cmp.ints(
        tag, si, "flags",
        &[got.split as u8, got.re_gang as u8, got.rod_jam as u8, got.scrammed as u8,
            got.rod_band as u8, got.melt as u8, got.breach as u8],
        &[want.split as u8, want.re_gang as u8, want.rod_jam as u8, want.scrammed as u8,
            want.rod_band as u8, want.melt as u8, want.breach as u8],
    );
    cmp.exact_f64(tag, si, "dnbrRing", &[got.dnbr_ring], &[want.dnbr_ring]);
    cmp.exact_f64(tag, si, "dnbrLev", &[got.dnbr_lev], &[want.dnbr_lev]);
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let mut c = Cur { b: &bytes, o: 0 };
    let np = c.u32() as usize;
    assert_eq!(c.u32(), 1, "format v1");
    // ---- const assertions ----
    let nconst = c.u32() as usize;
    let cv = c.f64a(nconst);
    let exp: Vec<f64> = vec![
        PROMPT_F, DEC_A[0], DEC_A[1], DEC_A[2], DEC_A[3], DEC_L[0], DEC_L[1], DEC_L[2], DEC_L[3],
        XTILTZ, XTAU_F, ROD_D0, ROD_CLAD, ZR_RHO, ZR_PBR, ZR_QOX, ZR_H2, CLAD_DT0, H_POOL,
        JL_K, JL_P, XC0, XMIX_MAX, SZ_LO, K_COOL, DNB_FILM, DT_LEID, MELT_LATCH, MELT_INV,
        MELT_FAT, FCI_TAU, FCI_ETA, DISP_H, DISP_SPAN, FUSE_KJ, FUEL_CP, FUSE_DT, T_STP,
        BURST_TAU, BURST_SPAN, BURST_LO_SIG, BURST_LO_T, BURST_HI_SIG, BURST_HI_T, OX_CP_A,
        OX_CP_B, OX_BJ_A, OX_BJ_B, OX_TSW, OX_VMIN, OX_T0, OX_ECR_FAIL, P_FILL, T_FILL,
        REL_GAP, REL_OX, REL_DISP, REL_MELT, W3_P, W3_G, W3_D, W3_Q, W3_H, W3_P_LO, W3_P_HI,
        W3_G_LO, W3_G_HI, W3_D_LO, W3_D_HI, W3_X_LO, W3_X_HI, SOR_OM,
    ];
    let mut cmp = Cmp { fails: 0, worst: 0.0, worst_at: String::new(), shown: 0 };
    if cv.len() != exp.len() {
        println!("CONSTS len {} vs {}", cv.len(), exp.len());
        cmp.fails += 1;
    } else {
        for (i, (&a, &b)) in cv.iter().zip(exp.iter()).enumerate() {
            if a.to_bits() != b.to_bits() {
                println!("CONST[{i}] {a:e} vs {b:e}");
                cmp.fails += 1;
            }
        }
    }
    let sor_sw = c.u32();
    if sor_sw as usize != SOR_SWEEPS {
        println!("SOR_SWEEPS {sor_sw} vs {}", SOR_SWEEPS);
        cmp.fails += 1;
    }
    let dry_min = c.f64a(1)[0];
    let cdtq = c.f64a(1)[0];
    if dry_min != 1e-6 || cdtq != 0.004 {
        println!("DRY/CDTQ {dry_min:e} {cdtq:e}");
        cmp.fails += 1;
    }
    let mut n_samples = [0u32; 4];
    for _ in 0..np {
        let ncores = c.u32() as usize;
        let mut ks = Vec::with_capacity(ncores);
        for _ in 0..ncores {
            let nb = c.u32() as usize;
            let kv = c.f64a(55);
            let satv = c.f64a(17);
            let sat = Curve::new(
                satv[0], satv[1], satv[2], satv[3], satv[4], satv[5], satv[6], satv[7], satv[8],
                satv[9], satv[10], satv[11], satv[12], satv[13], satv[14], satv[15], satv[16],
            );
            let fl = c.u8a(4);
            ks.push(CoreK {
                nb, sat, n0: kv[0], tf_ref: kv[1], tref: kv[2], rod_a: kv[3], tip_rho: kv[4],
                tip_len: kv[5], poison: kv[6], mix: kv[7], dt0: kv[8], dh: kv[9], a_heat: kv[10],
                g0: kv[11], film_pool: kv[12], x_sub: kv[13], x_sub_lo: kv[14], hfg: kv[15],
                flow_k: kv[16], pin_ua: kv[17], g_solid: kv[18], clad_r: kv[19], rod_d: kv[20],
                tmelt: kv[21], kxe: kv[22], a_f: kv[23], a_m: kv[24], a_x: kv[25], a_s: kv[26],
                a_v: kv[27], excess: kv[28], dnbr_k: kv[29], tdmg: kv[30], rated: kv[31],
                scram: kv[32], rod_rate: kv[33], burst_k: kv[34], p0: kv[35], core_kg0: kv[36],
                beta: kv[37], lam_big: kv[38], g_i: kv[39], lam_i: kv[40], g_x: kv[41],
                lam_x: kv[42], sig: kv[43], cr: kv[44], cz: kv[45], alb_r: kv[46], alb_t: kv[47],
                alb_b: kv[48], rinf: kv[49], burst_r: kv[50], rho0: kv[51], rho_beta: kv[52],
                plant_tref: kv[53], core_hgt: kv[54],
                poi_g: c.f64a(XNR), n_pen: c.f64a(XNR), enr_rho: c.f64a(XNR),
                rinf_w: c.f64a(XNR), bet: c.f64a(6), lam: c.f64a(6),
                bank_r: c.f64a(nb), bank_w: c.f64a(nb),
                oxid: fl[0] != 0, dryout: fl[1] != 0, tube: fl[2] != 0, dnb_law: fl[3],
            });
        }
        let ns = c.u32() as usize;
        for si in 0..ns {
            let tag = c.u32();
            let ci = c.u32() as usize;
            let k = &ks[ci];
            let nb = k.nb;
            let dt = c.f64a(1)[0];
            let tagnm = ["TICK", "NOD", "KIN", "ROD"][tag as usize];
            n_samples[tag as usize] += 1;
            if tag == 2 {
                // KIN: synthetic rho on (n, C).
                let rho_syn = c.f64a(1)[0];
                let n0 = c.f64a(1)[0];
                let c0 = c.f64a(6);
                let e_n = c.f64a(1)[0];
                let e_c = c.f64a(6);
                let mut cs = CoreState::default();
                cs.n = n0;
                cs.c = c0;
                cs.rho = rho_syn;
                cs.dnbr_min = 1.0;
                kinetics_step(k, &mut cs, dt);
                cmp.float1(tagnm, si, "n", cs.n, e_n);
                cmp.floats(tagnm, si, "C", &cs.c, &e_c);
                continue;
            }
            if tag == 3 {
                // ROD: synthetic scram/split on rod fields.
                let mut cs = read_cs(&mut c, nb);
                let sink = c.u32() != 0;
                let tilt_rate = c.f64a(1)[0];
                let want = read_cs(&mut c, nb);
                let trip_pre = c.strb();
                let trip_post = c.strb();
                let _ = (trip_pre, trip_post);
                rod_step(k, &mut cs, dt, sink, tilt_rate);
                cmp_cs(&mut cmp, tagnm, si, &cs, &want, nb);
                continue;
            }
            // TICK(0) and NOD(1) share the cs pre/post + o layout.
            let mut cs = read_cs(&mut c, nb);
            let trip_pre = c.strb();
            let args = c.f64a(8);
            let (heat, sat, v_leak, mflux, flow_frac, h_in, core_dt_max) =
                (args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
            let tilt_rate = args[7];
            let want = read_cs(&mut c, nb);
            let trip_post = c.strb();
            let e_o = c.f64a(10);
            if tag == 1 {
                let o = core_step(k, &mut cs, dt, heat, sat, v_leak, mflux, flow_frac, h_in, core_dt_max);
                cmp_cs(&mut cmp, tagnm, si, &cs, &want, nb);
                cmp.floats(tagnm, si, "o", &o.o, &e_o);
                let _ = trip_pre;
                let _ = trip_post;
                continue;
            }
            // TICK extras.
            let sink = c.u32() != 0;
            let inj = c.f64a(1)[0];
            let loop_kg = c.f64a(1)[0];
            let have_none = c.u32() != 0;
            let have = c.f64a(1)[0];
            let rel_part = c.f64a(1)[0];
            let dose = c.f64a(1)[0];
            let catcher = c.u32() != 0;
            let boron_s = c.f64a(1)[0];
            let h2node = c.i32();
            let h2m2none = c.u32() != 0;
            let h2m2 = c.f64a(1)[0];
            let h2pre = c.f64a(1)[0];
            let h2pre_has = c.u32() != 0;
            let e_h2node = c.f64a(1)[0];
            let e_h2has = c.u32() != 0;
            let e_release = c.f64a(1)[0];
            let release_pre = c.f64a(1)[0];
            let melt_node = c.i32();
            let e_melt_mass = c.f64a(1)[0];
            let e_melt_book = c.f64a(1)[0];
            let e_trip = c.strb();
            // Replay in tick order: rod → decay → fatigue → burst →
            // coreStep → vessel-tail → kinetics → melt.
            let mut trip = trip_pre.clone();
            rod_step(k, &mut cs, dt, sink, tilt_rate);
            decay_step(&mut cs, dt);
            if inj > 0.0 {
                cs.fatigue = fatigue_step(cs.fatigue, dt, inj);
            }
            let burst_p = k.p0 * (k.burst_k - 0.0028 * cs.fatigue);
            if k.tube {
                // `tubeStep` is plant-owned; the gate checks the dumped outcome.
                cs.breach = want.breach;
                trip = trip_post.clone();
            } else {
                let (b, t) = burst_logic(cs.breach, cs.p_core, burst_p);
                cs.breach = b;
                if t {
                    trip = "VESSEL RUPTURE".to_string();
                }
            }
            let o = core_step(k, &mut cs, dt, heat, sat, v_leak, mflux, flow_frac, h_in, core_dt_max);
            let (parts, rho, vf) = vessel_tail(&o, k.excess, boron_s, v_leak, cs.v_node);
            cs.parts = parts;
            cs.rho = rho;
            cs.vf = vf;
            cs.void_th = cs.v_node;
            cs.fci = o.o[9];
            kinetics_step(k, &mut cs, dt);
            if !cs.melt && cs.melt_frac >= MELT_LATCH {
                cs.melt = true;
                trip = "CORE MELT".to_string();
            }
            let mut melt_booked = 0.0;
            let mut melt_have: Option<f64> = None;
            if cs.melt_frac > 0.0 && !catcher {
                let (nh, bk) = melt_mass(
                    if have_none { None } else { Some(have) },
                    cs.melt_frac, dt, loop_kg,
                );
                melt_booked = bk;
                melt_have = nh;
            }
            if melt_node >= 0 && !have_none {
                if let Some(nh) = melt_have {
                    // Removal ran: the book closes on the melt line.
                    cmp.float1(tagnm, si, "meltMass", nh, e_melt_mass);
                } else {
                    // No removal: the node is untouched by the whole chain.
                    cmp.float1(tagnm, si, "meltMass", have, e_melt_mass);
                }
            }
            // H2 deposit at the vessel node.
            let mut h2node_v = h2pre;
            let mut h2node_has = h2pre_has;
            if o.o[8] > 0.0 && h2node >= 0 && !h2m2none && h2m2 > dry_min {
                h2node_v = h2pre + o.o[8] / h2m2;
                h2node_has = true;
            }
            cmp_cs(&mut cmp, tagnm, si, &cs, &want, nb);
            cmp.floats(tagnm, si, "o", &o.o, &e_o);
            cmp.float1(tagnm, si, "h2node", h2node_v, e_h2node);
            if h2node_has != e_h2has {
                cmp.fails += 1;
                println!("{tagnm} sample {si}: h2has {h2node_has} vs {e_h2has}");
            }
            // Release recomputed off the POST damage field (verifies
            // fuelStages + RELK weighting, not just the copy).
            let mut rel = 0.0;
            for kk in 0..XNN {
                rel += node_w_probe(kk)
                    * RELK[fuel_stage(
                        want.n_melt[kk], want.n_disp[kk], want.n_ox[kk], want.n_dmg[kk], 0.0,
                    )];
            }
            let e_rel = if rel > 0.0 {
                js_min(100.0, release_pre + rel * rel_part * dose * dt)
            } else {
                release_pre
            };
            cmp.float1(tagnm, si, "release", e_rel, e_release);
            cmp.float1(tagnm, si, "meltBook", melt_booked, e_melt_book);
            if trip != e_trip || trip_post != e_trip {
                cmp.fails += 1;
                println!("{tagnm} sample {si}: trip {trip}/{trip_post} vs {e_trip}");
            }
            let _ = trip_pre;
        }
    }
    println!(
        "presets={np} tick={} nod={} kin={} rod={} worst-rel={:e} @ {} FAILURES={}",
        n_samples[0], n_samples[1], n_samples[2], n_samples[3], cmp.worst, cmp.worst_at, cmp.fails
    );
}

fn node_w_probe(k: usize) -> f64 {
    let i = k / XNZ;
    let mut t = 0.0;
    for q in 0..XNR {
        t += (2 * q + 1) as f64;
    }
    (2 * i + 1) as f64 / t / XNZ as f64
}
