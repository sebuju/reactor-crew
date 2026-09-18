//! Meta inspector: names the nodes a failing index points at, per preset.
//! `meta-dump <dump.bin> [node ...]`
use sim_rs::ingest::*;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let want: Vec<usize> = a[2..].iter().filter_map(|s| s.parse().ok()).collect();
    let mut c = Cur { b: &bytes, o: 0, trace: false };
    let np = c.u32() as usize;
    let ver = c.u32();
    for pi in 0..np {
        let preset = read_preset(&mut c, ver);
        let m = &preset.meta.sec;
        for &i in &want {
            println!("preset {pi} node {i}: name={:?} circ={:?} cond_ves={:?} cond_ids={:?}",
                m.net_names.get(i), m.circ_of_node.get(i), m.cond_ves_node, m.cond_ids);
        }
        println!("preset {pi} relief_ids={:?} relief_node={:?} relief_sec={:?} shells_of={:?}",
            m.relief_ids, m.relief_node, m.relief_sec, m.shells_of);
        let nticks = c.u32() as usize;
        for ti in 0..nticks {
            let _ = read_tick(&mut c, &preset.meta, preset.core_ids.len(), pi, ti);
        }
    }
}
