//! Bulk EOS evaluator for the §6.1 gate (`node tools/eos-gate.js`).
//! Reads curves.bin + vectors.bin, writes out.bin (10 f64 LE per vector:
//! x, rho, b, satT, hfg, rf, rg, sp, tOfH, xOfH). Dev-only; never shipped.
use sim_rs::eos::*;

fn u32le(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}
fn f64le(b: &[u8], o: usize) -> f64 {
    f64::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], b[o + 5], b[o + 6], b[o + 7]])
}

fn load_curves(path: &str) -> Vec<Curve> {
    let b = std::fs::read(path).unwrap();
    let n = u32le(&b, 0) as usize;
    let mut o = 4;
    let mut out = Vec::with_capacity(n);
    for _ in 0..n {
        let mut v = [0.0; 17];
        for x in v.iter_mut() {
            *x = f64le(&b, o);
            o += 8;
        }
        out.push(Curve::new(
            v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10], v[11], v[12],
            v[13], v[14], v[15], v[16],
        ));
    }
    out
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    // modes: eos <curves> <vectors> <out> | pstar <curves> <vectors> <out>
    match a.get(1).map(|s| s.as_str()) {
        Some("pstar") => pstar_main(&a[2], &a[3], &a[4]),
        _ => {
            let off = if a.get(1).map(|s| s.as_str()) == Some("eos") { 1 } else { 0 };
            eos_main(&a[1 + off], &a[2 + off], &a[3 + off]);
        }
    }
}

fn pstar_main(curves_path: &str, vec_path: &str, out_path: &str) {
    let curves = load_curves(curves_path);
    let vb = std::fs::read(vec_path).unwrap();
    let n = u32le(&vb, 0) as usize;
    let mut out = Vec::with_capacity(4 + n * 16);
    out.extend_from_slice(&(n as u32).to_le_bytes());
    let mut o = 4;
    let mut s1 = [0.0; 3];
    let mut s2 = [0.0; 3];
    for _ in 0..n {
        let ci = vb[o] as usize;
        o += 1;
        let has_r0 = vb[o] != 0;
        o += 1;
        let p0 = f64le(&vb, o);
        o += 8;
        let h = f64le(&vb, o);
        o += 8;
        let rho_t = f64le(&vb, o);
        o += 8;
        let r0 = f64le(&vb, o);
        o += 8;
        let b0 = f64le(&vb, o);
        o += 8;
        let kp = f64le(&vb, o);
        o += 8;
        let kx = f64le(&vb, o);
        o += 8;
        let c = &curves[ci];
        let ps = net_pstar(c, p0, h, rho_t, has_r0.then_some(r0), has_r0.then_some(b0), &mut s1, &mut s2);
        let ka = net_kappa(c, kp, kx);
        out.extend_from_slice(&ps.to_le_bytes());
        out.extend_from_slice(&ka.to_le_bytes());
    }
    std::fs::write(out_path, out).unwrap();
}

fn eos_main(curves_path: &str, vec_path: &str, out_path: &str) {
    let curves = load_curves(curves_path);
    let vb = std::fs::read(vec_path).unwrap();
    let n = u32le(&vb, 0) as usize;
    let mut out = Vec::with_capacity(4 + n * 80);
    out.extend_from_slice(&(n as u32).to_le_bytes());
    let mut o = 4;
    let mut m = [0.0; 3];
    for _ in 0..n {
        let ci = vb[o] as usize;
        o += 1;
        let p = f64le(&vb, o);
        o += 8;
        let h = f64le(&vb, o);
        o += 8;
        let c = &curves[ci];
        mix_state(c, p, h, &mut m);
        let ts = sat_t(c, p);
        let vals = [
            m[MX_X],
            m[MX_RHO],
            m[MX_B],
            ts,
            hfg_of(c, ts),
            rhof_of(c, ts),
            rhog_of(c, ts),
            sat_p(c, ts),
            t_of_h(c, p, h),
            x_of_h(c, p, h),
        ];
        for v in vals {
            out.extend_from_slice(&v.to_le_bytes());
        }
    }
    std::fs::write(out_path, out).unwrap();
}
