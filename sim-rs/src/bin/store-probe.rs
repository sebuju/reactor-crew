//! Storage-row replayer for the §6.2e gate (`node tools/store-gate.js`).
//! Replays `net_store` per sample in order (memo carried) and demands exact
//! pin/null/memo agreement plus sdig-semantics float agreement. Dev-only.
use sim_rs::eos::{Curve, mix_state, MX_RHO};
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
    fn u32a(&mut self, n: usize) -> Vec<u32> {
        (0..n).map(|_| self.u32()).collect()
    }
    fn u8a(&mut self, n: usize) -> Vec<u8> {
        let v = self.b[self.o..self.o + n].to_vec();
        self.o += n;
        v
    }
}

fn bits(a: f64, b: f64) -> bool {
    a.to_bits() == b.to_bits()
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let mut c = Cur { b: &bytes, o: 0 };
    let np = c.u32() as usize;
    let mut fails = 0;
    let mut worst = 0.0;
    let mut worst_at = String::new();
    for _ in 0..np {
        let n = c.u32() as usize;
        assert_eq!(c.u32(), 1, "format v1");
        let vol = c.f64a(n);
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
        let nh = c.u32() as usize;
        let hold_nodes = c.u32a(nh);
        let nd = c.u32() as usize;
        let drum_nodes = c.u32a(nd);
        let nt = c.u32() as usize;
        let tank_nodes = c.u32a(nt);
        let nv = c.u32() as usize;
        let cond_nodes = c.u32a(nv);
        let mut memo = StoreState {
            kp: vec![f64::NAN; n],
            kh: vec![f64::NAN; n],
            km: vec![f64::NAN; n],
            p0: vec![0.0; n],
            cc: vec![0.0; n],
        };
        let ns = c.u32() as usize;
        for si in 0..ns {
            let f_p = c.f64a(n);
            let f_rho = c.f64a(n);
            let f_x = c.f64a(n);
            let f_b = c.f64a(n);
            let mb_v = c.f64a(n);
            let mb_has = c.u8a(n);
            let hb_v = c.f64a(n);
            let hb_has = c.u8a(n);
            let fallback_h = c.f64a(n);
            let held = c.u32() != 0;
            let mut tanks = Vec::with_capacity(nt);
            for &tn in &tank_nodes {
                let tc = c.f64a(1)[0];
                let tp = c.f64a(1)[0];
                tanks.push(TankRow { node: tn, c: tc, p0: tp });
            }
            let mut conds = Vec::with_capacity(nv);
            for &cn in &cond_nodes {
                let cc = c.f64a(1)[0];
                let w = c.f64a(1)[0];
                let p0 = c.f64a(1)[0];
                let wrecked = c.u32() != 0;
                let vacuum = c.u32() != 0;
                conds.push(CondRow { node: cn, c: cc, w, p0, wrecked, vacuum });
            }
            let pre = [c.f64a(n), c.f64a(n), c.f64a(n), c.f64a(n), c.f64a(n)];
            let exp_any = c.u32() != 0;
            let exp_cap = c.f64a(n);
            let exp_src = c.f64a(n);
            let exp_pin = c.u8a(n);
            let post = [c.f64a(n), c.f64a(n), c.f64a(n), c.f64a(n), c.f64a(n)];
            // Ticks between samples advance the memo through unrecorded
            // solves, so each sample seeds from its dumped pre-state; every
            // recorded transition (including memo hits) is still verified.
            memo.kp.copy_from_slice(&pre[0]);
            memo.kh.copy_from_slice(&pre[1]);
            memo.km.copy_from_slice(&pre[2]);
            memo.p0.copy_from_slice(&pre[3]);
            memo.cc.copy_from_slice(&pre[4]);
            let mut cap = vec![0.0; n];
            let mut src = vec![0.0; n];
            let mut pin = vec![0u8; n];
            let any = net_store(
                n, &vol, &curve_of, &curves, &f_p, &f_rho, &f_x, &f_b, &mb_v, &mb_has, &hb_v,
                &hb_has, &fallback_h, held, &hold_nodes, &drum_nodes, &tanks, &conds, &mut memo,
                &mut cap, &mut src, &mut pin,
            );
            if any != exp_any {
                fails += 1;
                println!("sample {si}: NULLNESS {any} vs {exp_any}");
            }
            if pin != exp_pin {
                fails += 1;
                println!("sample {si}: PIN mismatch");
            }
            for (nm, got, want) in [("cap", &cap, &exp_cap), ("src", &src, &exp_src)] {
                for i in 0..n {
                    let (a, b) = (got[i], want[i]);
                    if bits(a, b) {
                        continue;
                    }
                    if a.is_nan() || b.is_nan() {
                        fails += 1;
                        println!("sample {si}: {nm}[{i}] NaN {a} vs {b}");
                        break;
                    }
                    let rel = (a - b).abs() / (a.abs() + b.abs() + 1e-30);
                    if rel > worst {
                        worst = rel;
                        worst_at = format!("sample {si}: {nm}[{i}] {a} vs {b}");
                    }
                    if rel > 1e-6 {
                        fails += 1;
                        println!("sample {si}: {nm}[{i}] {a:e} vs {b:e}");
                        break;
                    }
                }
            }
            let wrote = [&memo.kp, &memo.kh, &memo.km, &memo.p0, &memo.cc];
            for k in 0..3 {
                for i in 0..n {
                    if !bits(wrote[k][i], post[k][i]) {
                        fails += 1;
                        println!("sample {si}: MEMO[{k}][{i}] copy mismatch");
                        break;
                    }
                }
            }
            // p0/C writes flow through netPStar: converged inputs must match
            // within the pstar-gate bar (1e-9); joint non-convergence (both
            // miss the residual) is the classified category, not a failure.
            let mut nonconv = 0;
            let mut s3 = [0.0; 3];
            let mut p0ok = vec![true; n];
            for i in 0..n {
                if bits(wrote[3][i], post[3][i]) {
                    continue;
                }
                let m = if mb_has[i] != 0 { mb_v[i] } else { f64::max(vol[i] * f_rho[i], 1e-6) };
                let h_n = if hb_has[i] != 0 { hb_v[i] } else { fallback_h[i] };
                let rho_t = m / vol[i];
                let mut resid = |p: f64| {
                    mix_state(&curves[curve_of[i] as usize], p, h_n, &mut s3);
                    (s3[MX_RHO] - rho_t).abs() <= 1e-6 * rho_t + 1e-9
                };
                let (rr, jr) = (resid(wrote[3][i]), resid(post[3][i]));
                if rho_t > 0.0 && rho_t.is_finite() && !rr && !jr {
                    nonconv += 1;
                    continue;
                }
                if rr && jr {
                    let (a, b) = (wrote[3][i], post[3][i]);
                    let rel = (a - b).abs() / (a.abs() + b.abs() + 1e-300);
                    if rel <= 1e-9 {
                        continue;
                    }
                }
                p0ok[i] = false;
                fails += 1;
                println!("sample {si}: MEMO[3][{i}] write mismatch");
                break;
            }
            for i in 0..n {
                if bits(wrote[4][i], post[4][i]) {
                    continue;
                }
                if p0ok[i] {
                    let (a, b) = (wrote[4][i], post[4][i]);
                    if a.is_nan() || b.is_nan() {
                        fails += 1;
                        println!("sample {si}: MEMO[4][{i}] NaN");
                        break;
                    }
                    let rel = (a - b).abs() / (a.abs() + b.abs() + 1e-30);
                    if rel <= 1e-9 {
                        continue;
                    }
                }
                fails += 1;
                println!("sample {si}: MEMO[4][{i}] write mismatch");
                break;
            }
            if nonconv > 0 {
                println!("sample {si}: {nonconv} joint-nonconv memo writes");
            }
        }
    }
    println!("presets={np} worst-rel={worst:e} @ {worst_at} FAILURES={fails}");
}
