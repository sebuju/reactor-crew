//! Shared scaffolding for the probe harnesses (bins only, never shipped):
//! mini JSON for the gate's debug sidecar, the `freeze.bin` reader and the
//! post-ctl replay snapshot via the ported `act_follow`.
use sim_rs::freeze::{read_freeze, FreezeIn};
use sim_rs::ingest::Cur;
use sim_rs::sec;
use std::collections::HashMap;

/// `freeze.bin`: one `FREEZE.build()` payload per preset, in dump order.
pub fn read_freezes(path: &str) -> Vec<FreezeIn> {
    let b = std::fs::read(path).unwrap();
    let mut c = Cur { b: &b, o: 0, trace: false };
    let mut v = vec![];
    while c.o < b.len() {
        v.push(read_freeze(&mut c).expect("freeze.bin: bad magic/version"));
    }
    v
}

#[derive(Debug, Clone)]
pub enum J {
    N(f64),
    S(String),
    A(Vec<J>),
    O(HashMap<String, J>),
}

pub fn jparse(s: &str) -> J {
    let b = s.as_bytes();
    let mut o = 0usize;
    jval(b, &mut o)
}

fn jws(b: &[u8], o: &mut usize) {
    while *o < b.len() && (b[*o] == b' ' || b[*o] == b'\t' || b[*o] == b'\n' || b[*o] == b'\r') {
        *o += 1;
    }
}

fn jval(b: &[u8], o: &mut usize) -> J {
    jws(b, o);
    match b[*o] {
        b'{' => {
            *o += 1;
            let mut m = HashMap::new();
            jws(b, o);
            if b[*o] == b'}' {
                *o += 1;
                return J::O(m);
            }
            loop {
                jws(b, o);
                assert_eq!(b[*o], b'"', "obj key");
                let k = jstr(b, o);
                jws(b, o);
                assert_eq!(b[*o], b':', "colon");
                *o += 1;
                m.insert(k, jval(b, o));
                jws(b, o);
                if b[*o] == b',' {
                    *o += 1;
                    continue;
                }
                assert_eq!(b[*o], b'}', "obj end");
                *o += 1;
                break;
            }
            J::O(m)
        }
        b'[' => {
            *o += 1;
            let mut v = vec![];
            jws(b, o);
            if b[*o] == b']' {
                *o += 1;
                return J::A(v);
            }
            loop {
                v.push(jval(b, o));
                jws(b, o);
                if b[*o] == b',' {
                    *o += 1;
                    continue;
                }
                assert_eq!(b[*o], b']', "arr end");
                *o += 1;
                break;
            }
            J::A(v)
        }
        b'"' => J::S(jstr(b, o)),
        _ => {
            let s = *o;
            while *o < b.len() && !b" \t\n\r,]}".contains(&b[*o]) {
                *o += 1;
            }
            let t = std::str::from_utf8(&b[s..*o]).unwrap_or("NaN");
            match t {
                "true" => J::N(1.0),
                "false" => J::N(0.0),
                "null" => J::N(f64::NAN),
                _ => J::N(t.parse().unwrap_or(f64::NAN)),
            }
        }
    }
}

fn jstr(b: &[u8], o: &mut usize) -> String {
    assert_eq!(b[*o], b'"');
    *o += 1;
    let mut s = String::new();
    while b[*o] != b'"' {
        if b[*o] == b'\\' {
            *o += 1;
            s.push(b[*o] as char);
        } else {
            s.push(b[*o] as char);
        }
        *o += 1;
    }
    *o += 1;
    s
}

pub fn jstrs(j: &J) -> Vec<String> {
    match j {
        J::A(v) => v.iter().map(|x| match x {
            J::S(s) => s.clone(),
            J::N(n) => format!("{n}"),
            _ => "?".to_string(),
        }).collect(),
        _ => vec![],
    }
}

/// Replay post-ctl fixture: re-evaluate the recorded pass, apply demands,
/// lag motors — everything lanes/sig read, advanced on the passed state.
/// The engine performs the same three calls live (live_ctl → apply_act →
/// act_follow); this fixture replays recorded truth for verification.
pub fn replay_postpass(
    meta: &sim_rs::step::StepMeta,
    mut st: sim_rs::step::StepState,
    sample: &sim_rs::ctl::Sample,
    keys: &sim_rs::step::CtlMeta,
    dt: f64,
) -> sim_rs::step::StepState {
    let rep = sim_rs::ctl::ctl_replay(sample);
    sim_rs::live::apply_act(keys, &mut st, &rep.act);
    let inp = sec::SecIn { dt, ..Default::default() };
    let mut ev = vec![];
    let mut warns = 0u32;
    let mut cx = sec::Cx {
        meta: &meta.sec,
        curves: &meta.sec_curves,
        st: &mut st.sec,
        inp: &inp,
        ev: &mut ev,
        warns: &mut warns,
    };
    sec::act_follow(&mut cx);
    st
}
/// One tick's piece-cache decision from the gate sidecar (`pcdec` line).
pub struct PcDec {
    pub reuse: bool,
    pub sig_pre: String,
    pub sig_solve: String,
}

/// Parse `pcdec`/`sigseg` debug lines: preset idx by tag-0 rollover.
/// Returns (per-preset-per-tick decisions, per-preset siglists index order).
pub fn parse_pcdec(dbg: &str) -> HashMap<(usize, usize), PcDec> {
    let mut out = HashMap::new();
    let mut cur = 0usize;
    let mut last: Option<usize> = None;
    for ln in dbg.lines() {
        if let Some(rest) = ln.strip_prefix("pcdec t=") {
            let mut it = rest.split(' ');
            let tg: usize = it.next().unwrap_or("0").parse().unwrap_or(0);
            if tg == 0 && last.map(|l| l != 0).unwrap_or(false) {
                cur += 1;
            }
            last = Some(tg);
            let mut reuse = false;
            let mut sig_pre = String::new();
            let mut sig_solve = String::new();
            for kv in it {
                if let Some(v) = kv.strip_prefix("reuse=") {
                    reuse = v == "true";
                } else if let Some(v) = kv.strip_prefix("sigPre=") {
                    sig_pre = v.to_string();
                } else if let Some(v) = kv.strip_prefix("sigSolve=") {
                    sig_solve = v.to_string();
                }
            }
            out.insert((cur, tg), PcDec { reuse, sig_pre, sig_solve });
        }
    }
    out
}
