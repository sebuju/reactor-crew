//! Network pieces and the fixed set, ported from `src/data/pipenet.js`:
//! `netPieces`, `corePieces`, `netRef`, `netFixed`, `netBounds`, `holdLive`.
//!
//! Integer logic and copies throughout — agreement with JS is bit-exact.
//! Plant-coupled predicates (which tanks pin, containment pressures, live
//! signature) arrive pre-evaluated; their own stages port the predicates.
//! (`holdLive` allocates a pair buffer here; the tick path will pool it
//! once the §5 dev-allocator trap lands.)

/// Connected components over the live edges. Returns (of, n_piece, live).
pub fn net_pieces(n: usize, eu: &[u32], ev: &[u32], g: &[f64]) -> (Vec<i32>, usize, Vec<u8>) {
    let mut of = vec![-1i32; n];
    let mut live = vec![0u8; eu.len()];
    let mut adj: Vec<Vec<u32>> = vec![Vec::new(); n];
    for e in 0..eu.len() {
        if !(g[e] > 0.0) {
            continue;
        }
        live[e] = 1;
        adj[eu[e] as usize].push(ev[e]);
        adj[ev[e] as usize].push(eu[e]);
    }
    let mut c = 0;
    let mut st: Vec<u32> = Vec::new();
    for i in 0..n {
        if of[i] >= 0 {
            continue;
        }
        st.clear();
        st.push(i as u32);
        of[i] = c;
        while let Some(a) = st.pop() {
            for &v in &adj[a as usize] {
                if of[v as usize] < 0 {
                    of[v as usize] = c;
                    st.push(v);
                }
            }
        }
        c += 1;
    }
    (of, c as usize, live)
}

/// The live pieces the vessels stand in (sorted, deduped).
pub fn core_pieces(of: &[i32], core_nodes: &[u32], core_node: u32) -> Vec<i32> {
    let mut set: Vec<i32> = core_nodes.iter().map(|&i| of[i as usize]).collect();
    if set.is_empty() {
        set.push(of[core_node as usize]);
    }
    set.sort();
    set.dedup();
    set
}

/// The piece frame: every piece floats at `level` until something pins it.
pub fn ref_frame(n_piece: usize, level: f64) -> (Vec<f64>, Vec<i32>) {
    (vec![level; n_piece], vec![-1; n_piece])
}

/// The fixed set. All pin lists arrive pre-evaluated as (node, pressure);
/// this replays the fill order exactly (later classes overwrite earlier).
/// `seed_v` is the holder's pre-call content: JS clears the mask but never
/// the values, so stale pressures persist where no pin lands.
#[allow(clippy::too_many_arguments)]
pub fn fixed_fill(
    n: usize,
    seed_v: &[f64],
    ref_anchor: &[i32],
    ref_p0: &[f64],
    cont: &[(u32, f64)],
    store_held: bool,
    hold_pins: &[(u32, f64)],
    drum_pins: &[(u32, f64)],
    tank_pins: &[(u32, f64)],
    sec_pins: &[(u32, f64)],
    cond_pins: &[(u32, f64)],
) -> (Vec<f64>, Vec<u8>) {
    let mut fv = seed_v.to_vec();
    debug_assert_eq!(fv.len(), n);
    let mut fh = vec![0u8; n];
    for (c, &a) in ref_anchor.iter().enumerate() {
        if a >= 0 {
            fv[a as usize] = ref_p0[c];
            fh[a as usize] = 1;
        }
    }
    for &(i, p) in cont {
        fv[i as usize] = p;
        fh[i as usize] = 1;
    }
    if store_held {
        for &(i, p) in hold_pins {
            fv[i as usize] = p;
            fh[i as usize] = 1;
        }
        for &(i, p) in drum_pins {
            fv[i as usize] = p;
            fh[i as usize] = 1;
        }
    }
    for &(i, p) in tank_pins {
        fv[i as usize] = p;
        fh[i as usize] = 1;
    }
    if store_held {
        for &(i, p) in sec_pins {
            fv[i as usize] = p;
            fh[i as usize] = 1;
        }
        for &(i, p) in cond_pins {
            fv[i as usize] = p;
            fh[i as usize] = 1;
        }
    }
    (fv, fh)
}

/// `netBounds`: storing vessels outside the field pin at marker 0.
pub fn bounds_fill(fv: &mut [f64], fh: &mut [u8], storing: &[u32]) {
    for &i in storing {
        let i = i as usize;
        if fh[i] == 0 {
            fv[i] = 0.0;
            fh[i] = 1;
        }
    }
}

/// Live when the hold tank's piece has a cycle in it: a tree hanging off
/// the vessel is a stub it pressurises and nothing else.
pub fn hold_live(
    n: usize,
    adj: &[Vec<u32>],
    live: &[u8],
    eu: &[u32],
    ev: &[u32],
    seed: u32,
    fixed_has: &[u8],
) -> bool {
    let mut seen = vec![0u8; n];
    let mut stack = vec![seed];
    seen[seed as usize] = 1;
    let mut nodes = 1;
    while let Some(a) = stack.pop() {
        for &v in &adj[a as usize] {
            if seen[v as usize] != 0 || fixed_has[v as usize] != 0 {
                continue;
            }
            seen[v as usize] = 1;
            nodes += 1;
            stack.push(v);
        }
    }
    let mut pairs: Vec<u64> = Vec::new();
    for e in 0..eu.len() {
        let (u, v) = (eu[e], ev[e]);
        if live[e] == 0 || seen[u as usize] == 0 || seen[v as usize] == 0 || u == v {
            continue;
        }
        pairs.push(if u < v { u as u64 * n as u64 + v as u64 } else { v as u64 * n as u64 + u as u64 });
    }
    pairs.sort();
    pairs.dedup();
    pairs.len() >= nodes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pieces_split_on_dead_edge() {
        // 0-1 live, 1-2 dead, 2-3 live, 4 alone.
        let (eu, ev, g) = (vec![0, 1, 2], vec![1, 2, 3], vec![1.0, 0.0, 2.0]);
        let (of, n, live) = net_pieces(5, &eu, &ev, &g);
        assert_eq!(n, 3);
        assert_eq!(live, vec![1, 0, 1]);
        assert_eq!(of[0], of[1]);
        assert_eq!(of[2], of[3]);
        assert!(of[0] != of[2] && of[4] != of[0] && of[4] != of[2]);
    }

    #[test]
    fn liveness_mapping_edges() {
        // `!(g > 0)`: NaN, -0, 0 and negatives are dead; only + is live.
        let (eu, ev) = (vec![0, 1, 2, 3], vec![1, 2, 3, 4]);
        let g = vec![1e-300, 0.0, -0.0, f64::NAN];
        let (of, n, live) = net_pieces(5, &eu, &ev, &g);
        assert_eq!(live, vec![1, 0, 0, 0]);
        assert_eq!(n, 4);
        assert_eq!(of[0], of[1]);
    }

    #[test]
    fn hold_tree_vs_cycle() {
        // 0-1-2 line (tree): seed 0 sees 3 nodes, 2 pairs -> false.
        // triangle: 3 pairs -> true.
        let (eu, ev) = (vec![0, 1], vec![1, 2]);
        let (of, _, live) = net_pieces(3, &eu, &ev, &[1.0, 1.0]);
        let _ = of;
        let adj = vec![vec![1], vec![0, 2], vec![1]];
        assert!(!hold_live(3, &adj, &live, &eu, &ev, 0, &[0, 0, 0]));
        let (eu2, ev2) = (vec![0, 1, 2], vec![1, 2, 0]);
        let (_, _, live2) = net_pieces(3, &eu2, &ev2, &[1.0, 1.0, 1.0]);
        let adj2 = vec![vec![1, 2], vec![0, 2], vec![1, 0]];
        assert!(hold_live(3, &adj2, &live2, &eu2, &ev2, 0, &[0, 0, 0]));
        // A fixed node is reached, never crossed: seed 0 behind fixed 1.
        assert!(!hold_live(3, &adj, &live, &eu, &ev, 0, &[0, 1, 0]));
    }
}
