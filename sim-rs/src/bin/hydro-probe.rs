//! Bulk hydraulics evaluator for the §6.2b gate (`node tools/hydro-gate.js`).
//! Reads field arrays + edge queries, writes 6 f64 LE per query:
//! fric, pipeC, holeC, flowW, flowG g, choke 0/1. Dev-only.
use sim_rs::hydro::*;

fn u32le(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}
fn f64le(b: &[u8], o: usize) -> f64 {
    f64::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], b[o + 5], b[o + 6], b[o + 7]])
}

const NONE: u32 = 0xffff_ffff;
// query floats: bore, w, hasW, L, K0, hasF, fF,
//               flowW: Cq, rhoQ, pHiQ, pLoQ,
//               flowG: gC, hG, diode, hSrc   (15 total)
// query ints: u, v, chokeAt, gasAt, liqAt (idx or NONE)
const NF: usize = 15;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let b = std::fs::read(&a[1]).unwrap();
    let mut o = 0;
    let nn = u32le(&b, o) as usize;
    o += 4;
    let mut arr = || {
        let mut v = Vec::with_capacity(nn);
        for _ in 0..nn {
            v.push(f64le(&b, o));
            o += 8;
        }
        v
    };
    let (p, x, rho_d, rho_g, rho_l, mu) = (arr(), arr(), arr(), arr(), arr(), arr());
    let mut u8arr = || {
        let mut v = Vec::with_capacity(nn);
        for _ in 0..nn {
            v.push(b[o]);
            o += 1;
        }
        v
    };
    let (wet, void_) = (u8arr(), u8arr());
    let nq = u32le(&b, o) as usize;
    o += 4;
    let field = FlowField {
        p: &p,
        x: Some(&x),
        wet: Some(&wet),
        void_: Some(&void_),
        rho_d: &rho_d,
        rho_g: &rho_g,
        rho_l: &rho_l,
    };
    let mut out = Vec::with_capacity(4 + nq * 48);
    out.extend_from_slice(&(nq as u32).to_le_bytes());
    for _ in 0..nq {
        let mut qf = [0.0; NF];
        for x in qf.iter_mut() {
            *x = f64le(&b, o);
            o += 8;
        }
        let mut qi = [0u32; 5];
        for x in qi.iter_mut() {
            *x = u32le(&b, o);
            o += 4;
        }
        let opt = |v: u32| if v == NONE { None } else { Some(v as usize) };
        let (eu, ev) = (qi[0] as usize, qi[1] as usize);
        let fr = fric_of(qf[0], (qf[2] != 0.0).then_some(qf[1]), mu[eu]);
        let pc = pipe_c(qf[0], qf[3], qf[4], (qf[5] != 0.0).then_some(qf[6]));
        let hc = hole_c(qf[0]);
        let fw = flow_w(qf[7], qf[8], qf[9], qf[10]);
        let (g, choke) = flow_g(
            qf[11], &field, eu, ev, qf[12], qf[13], qf[14], opt(qi[2]), opt(qi[3]), opt(qi[4]),
        );
        for v in [fr, pc, hc, fw, g, if choke { 1.0 } else { 0.0 }] {
            out.extend_from_slice(&v.to_le_bytes());
        }
    }
    std::fs::write(&a[2], out).unwrap();
}
