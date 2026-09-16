//! Bulk linear-core replayer for the §6.2a gate (`node tools/solve-gate.js`).
//! Replays order/assemble/factor/subst/unfix/flows per sample and demands
//! bit-exact b, q, order, deg and diverge-set agreement. Dev-only.
use sim_rs::net::*;

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
    let ns = c.u32() as usize;
    let mut fails = 0;
    for si in 0..ns {
        let (n, ne) = (c.u32() as usize, c.u32() as usize);
        assert_eq!(c.u32(), 2, "format v2");
        let (uu, vv) = (c.u32a(ne), c.u32a(ne));
        let (gh_g, gh_h) = (c.f64a(ne), c.f64a(ne));
        let (fx_v, fx_h) = (c.f64a(n), c.u8a(n));
        let has_store = c.u32() != 0;
        let (cap, src) = if has_store { (Some(c.f64a(n)), Some(c.f64a(n))) } else { (None, None) };
        let with_cap = c.u32() != 0;
        let b_asm = c.f64a(n);
        let (b_js, q_js) = (c.f64a(n), c.f64a(ne));
        let no = c.u32() as usize;
        let order_js = c.u32a(no);
        let deg_js = c.u8a(n);
        let nw = c.u32() as usize;
        let widx_js = c.u32a(nw);

        // order
        let order = net_order(n, &uu, &vv, &fx_h);
        if order != order_js {
            fails += 1;
            println!("sample {si}: ORDER mismatch (nf {} vs {})", order.len(), order_js.len());
            continue;
        }
        // row map + bandwidth, same terms as netFactored
        let nf = order.len();
        let mut row = vec![0u32; n];
        for (k, &f) in order.iter().enumerate() {
            row[f as usize] = k as u32;
        }
        let mut bw = 0usize;
        for e in 0..ne {
            let (eu, ev) = (uu[e] as usize, vv[e] as usize);
            if fx_h[eu] != 0 || fx_h[ev] != 0 {
                continue;
            }
            let d = (row[eu] as i64 - row[ev] as i64).unsigned_abs() as usize;
            if d > bw {
                bw = d;
            }
        }
        // assemble (cap rides iff the refactor path filled b)
        let mut aa = vec![0.0; nf * nf];
        let mut b = vec![0.0; n];
        let mut touch = vec![0u8; n];
        let cap_arg: Option<&[f64]> = if with_cap { cap.as_deref() } else { None };
        net_assemble(
            &uu, &vv, &gh_g, &gh_h, &fx_v, &fx_h,
            cap_arg, src.as_deref(),
            Some(&row), nf, n, Some(&mut touch),
            Some(&mut aa), &mut b,
        );
        for i in 0..n {
            if !bits(b[i], b_asm[i]) {
                fails += 1;
                println!("sample {si}: B[{i}] {:e} vs {:e}", b[i], b_asm[i]);
                break;
            }
        }
        // factor
        let mut deg = vec![0u8; nf.max(1)];
        let mut d0 = vec![0.0; nf.max(1)];
        if nf > 0 {
            net_factor(&mut aa, nf, Some(&mut deg), Some(bw), &mut d0);
        }
        // subst over compacted vector, scatter (netSubstFree)
        let mut cc = vec![0.0; nf];
        for (k, &f) in order.iter().enumerate() {
            cc[k] = b[f as usize];
        }
        if nf > 0 {
            net_subst(&aa, &mut cc, nf, Some(bw));
        }
        let mut p = vec![0.0; n];
        for (k, &f) in order.iter().enumerate() {
            p[f as usize] = cc[k];
        }
        net_unfix(&mut p, &fx_v, &fx_h, n);
        for i in 0..n {
            if !bits(p[i], b_js[i]) {
                fails += 1;
                println!("sample {si}: P[{i}] {:e} vs {:e}", p[i], b_js[i]);
                break;
            }
        }
        // flows
        let mut q = vec![0.0; ne];
        net_flows(&uu, &vv, &gh_g, &gh_h, &p, &fx_v, &fx_h, &mut q);
        for e in 0..ne {
            if !bits(q[e], q_js[e]) {
                fails += 1;
                println!("sample {si}: Q[{e}] {:e} vs {:e}", q[e], q_js[e]);
                break;
            }
        }
        // deg scattered back to node index, like netFactored
        let mut deg_n = vec![0u8; n];
        for (k, &f) in order.iter().enumerate() {
            deg_n[f as usize] = deg[k];
        }
        if deg_n != deg_js {
            fails += 1;
            println!("sample {si}: DEG mismatch");
        }
        // diverge set
        let (res, _) = diverge_check(&uu, &vv, &q, &fx_h, Some(&deg_n), cap.as_deref(), src.as_deref(), &p, n);
        let mut got: Vec<u32> = res.into_iter().map(|(i, _)| i as u32).collect();
        got.sort();
        let mut want = widx_js.clone();
        want.sort();
        if got != want {
            fails += 1;
            println!("sample {si}: DIVERGE set {:?} vs {:?}", got, want);
        }
    }
    println!("samples={ns} FAILURES={fails}");
}
