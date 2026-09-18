//! Shared tick-scope plumbing for the §6.6 port (`sec`, `room`, `events`).
//!
//! Rules: identical IEEE op order to the JS; `Math.max/min` NaN semantics
//! via `eos::js_max/js_min`; transcendentals via `libm` (sdig class).
//! `logE` sites record `(sev, code)` — English text stays JS-side per the
//! ABI; the gate maps codes back to message prefixes (`tools/*-gate.js`).

use crate::eos::{js_max, js_min, Curve};

/// `logE` severity, matching `sim/log.js` (`alarm`/`warn`/`info`).
pub const SEV_ALARM: u8 = 0;
pub const SEV_WARN: u8 = 1;
pub const SEV_INFO: u8 = 2;

/// Event codes, one per tick-scope `logE` call site (assigned in tick
/// order within each extracted function).
// sec: burst dice
pub const EV_PIPE_BURST: u32 = 1;
pub const EV_WALL_BURST: u32 = 2;
// sec: secondary latches
pub const EV_SG_BURST: u32 = 3;
pub const EV_DISC_BURST: u32 = 4;
pub const EV_COND_LOST: u32 = 5;
pub const EV_TURB_TRIP: u32 = 6;
pub const EV_TURB_RELATCH: u32 = 7;
pub const EV_COND_VENT: u32 = 8;
pub const EV_RELIEF_LIFT: u32 = 9;
// room: sump flood
pub const EV_FLOOD: u32 = 11;
// events: blast / overpressure
pub const EV_BLAST_LATCH: u32 = 20;
pub const EV_BLAST_DMG: u32 = 21;
pub const EV_CRUSH_DMG: u32 = 22;
pub const EV_SHELL_FAIL: u32 = 23;
// events: burn / fire latches
pub const EV_DEFLAGRATION: u32 = 24;
pub const EV_NAFIRE: u32 = 25;
// events: cook damage
pub const EV_HEAT_DMG: u32 = 26;
// events: ev latches, in tick order
pub const EV_HIPOW: u32 = 30;
pub const EV_DNBR13: u32 = 31;
pub const EV_DNBR10: u32 = 32;
pub const EV_SCRAM: u32 = 33;
pub const EV_RECRIT: u32 = 34;
pub const EV_CAV: u32 = 35;
pub const EV_DRY: u32 = 36;
pub const EV_FLOWFLOOR: u32 = 37;
pub const EV_HIP: u32 = 38;
pub const EV_PORV: u32 = 39;
pub const EV_STUCK: u32 = 40;
pub const EV_VOID: u32 = 41;
pub const EV_HIRAD: u32 = 42;
pub const EV_HIROOM: u32 = 43;
pub const EV_H2ROOM: u32 = 44;
pub const EV_PIT: u32 = 45;
pub const EV_JAM: u32 = 46;
pub const EV_BYP_RPS: u32 = 47;
pub const EV_BYP_RUNBACK: u32 = 48;
pub const EV_NORPS: u32 = 49;
pub const EV_INJ: u32 = 50;
pub const EV_D1: u32 = 51;
pub const EV_D25: u32 = 52;
pub const EV_CREW50: u32 = 53;
pub const EV_FAT50: u32 = 54;
pub const EV_BRK: u32 = 55;
pub const EV_OX: u32 = 56;
pub const EV_H2: u32 = 57;
pub const EV_MELT: u32 = 58;
// core: tube rupture / shield lift (dumped outcome in full-tick replay)
pub const EV_TUBE: u32 = 63;
pub const EV_SHIELD: u32 = 64;
// events: repair
pub const EV_REPAIR_OUT: u32 = 61;
pub const EV_REPAIR_DONE: u32 = 62;

/// Cold-path `log_event` import condensed for the native replayer: severity
/// plus the call-site code above.
#[derive(Clone, PartialEq, Debug)]
pub struct LogEv {
    pub sev: u8,
    pub code: u32,
    /// The ids the JS line names that the page cannot read back off S.
    pub ids: Vec<String>,
}

impl LogEv {
    pub fn new(sev: u8, code: u32) -> Self {
        LogEv { sev, code, ids: vec![] }
    }
    pub fn with(sev: u8, code: u32, ids: Vec<String>) -> Self {
        LogEv { sev, code, ids }
    }
}

// ---------------------------------------------------------------------------
// `dmgFx` hit/fix applier (`src/sim/step.js` DMGFX), shared by the room
// (flood) and events (blast/cook/repair) replayers. Only core/rods/turb/
// cond/bkp/tank/sg rows mutate; pipe/mat/port/pump/radiator/ctrl are null.
// ---------------------------------------------------------------------------

/// Per-core fields a hit reads or writes (demands read the live values).
#[derive(Clone, Default)]
pub struct DmgCore {
    pub breach: bool,
    pub trip: Option<String>,
    pub fatigue: f64,
    pub rod_jam: bool,
    pub rod_dem: f64,
    pub tilt_dem: f64,
    pub rod_z_dem: Vec<f64>,
    pub rod_pos: f64,
    pub tilt: f64,
    pub rod_z: Vec<f64>,
}

/// Everything a hit or fix can touch.
#[derive(Clone, Default)]
pub struct DmgState {
    pub load: f64,
    pub load_dem: f64,
    pub bkp_lost: bool,
    pub sgtr: bool,
    pub cores: std::collections::HashMap<String, DmgCore>,
    pub relief_open: std::collections::HashMap<String, bool>,
    pub relief_stuck: std::collections::HashMap<String, bool>,
    pub relief_auto: std::collections::HashMap<String, bool>,
}

/// Structural facts the applier needs: part roles, `D.machines` host links,
// NB per core, tank hold flags, the primary relief fitting.
pub struct DmgCtx<'a> {
    pub part_role: &'a std::collections::HashMap<String, String>,
    pub part_on: &'a std::collections::HashMap<String, Option<String>>,
    pub nb: &'a std::collections::HashMap<String, usize>,
    pub tank_hold: &'a std::collections::HashMap<String, bool>,
    pub primary_relief: Option<String>,
}

const DMG_ORDER: [&str; 13] = [
    "core", "rods", "turb", "cond", "radiator", "ctrl", "bkp",
    "tank", "pump", "sg", "port", "mat", "pipe",
];

/// Row resolution: exact id, then part role, then first id-prefix, else any.
pub fn dmg_row(id: &str, ctx: &DmgCtx) -> &'static str {
    if DMG_ORDER.contains(&id) {
        return match id {
            "core" => "core", "rods" => "rods", "turb" => "turb",
            "cond" => "cond", "radiator" => "radiator", "ctrl" => "ctrl",
            "bkp" => "bkp", "tank" => "tank", "pump" => "pump",
            "sg" => "sg", "port" => "port", "mat" => "mat",
            _ => "pipe",
        };
    }
    if let Some(role) = ctx.part_role.get(id) {
        if DMG_ORDER.contains(&role.as_str()) {
            return match role.as_str() {
                "core" => "core", "rods" => "rods", "turb" => "turb",
                "cond" => "cond", "radiator" => "radiator", "ctrl" => "ctrl",
                "bkp" => "bkp", "tank" => "tank", "pump" => "pump",
                "sg" => "sg", "port" => "port", "mat" => "mat",
                _ => "pipe",
            };
        }
    }
    for k in DMG_ORDER {
        if id.starts_with(k) {
            return k;
        }
    }
    "any"
}

fn dmg_core_of(id: &str, ctx: &DmgCtx) -> Option<String> {
    if ctx.part_role.get(id).map(|r| r == "core").unwrap_or(false) {
        return Some(id.to_string());
    }
    let host = ctx.part_on.get(id).and_then(|o| o.clone())?;
    if ctx.part_role.get(&host).map(|r| r == "core").unwrap_or(false) {
        return Some(host);
    }
    None
}

/// `hit()`: what a hit does to the plant.
pub fn dmg_hit(id: &str, ctx: &DmgCtx, st: &mut DmgState) {
    match dmg_row(id, ctx) {
        "core" => {
            if let Some(cs) = st.cores.get_mut(id) {
                cs.breach = true;
                if cs.trip.as_deref().unwrap_or("").is_empty() {
                    cs.trip = Some("VESSEL RUPTURE".to_string());
                }
                cs.fatigue = js_min(100.0, cs.fatigue + 12.0);
            }
        }
        "rods" => {
            if let Some(cid) = dmg_core_of(id, ctx) {
                if let Some(cs) = st.cores.get_mut(&cid) {
                    cs.rod_jam = true;
                    cs.rod_dem = cs.rod_pos;
                    cs.tilt_dem = cs.tilt;
                    cs.rod_z_dem = cs.rod_z.clone();
                }
            }
        }
        "turb" | "cond" => {
            st.load = 0.05;
            st.load_dem = 0.05;
        }
        "bkp" => {
            st.bkp_lost = true;
        }
        "tank" => {
            if !ctx.tank_hold.get(id).copied().unwrap_or(false) {
                return;
            }
            if let Some(fid) = ctx.primary_relief.clone() {
                st.relief_open.insert(fid.clone(), true);
                st.relief_stuck.insert(fid.clone(), true);
                st.relief_auto.insert(fid, true);
            }
        }
        "sg" => {
            st.sgtr = true;
        }
        _ => {}
    }
}

/// `fix()`: what a repair party reverses (null rows are no-ops).
pub fn dmg_fix(id: &str, ctx: &DmgCtx, st: &mut DmgState) {
    match dmg_row(id, ctx) {
        "rods" => {
            if let Some(cid) = dmg_core_of(id, ctx) {
                if let Some(cs) = st.cores.get_mut(&cid) {
                    cs.rod_jam = false;
                }
            }
        }
        "bkp" => {
            st.bkp_lost = false;
        }
        "tank" => {
            if !ctx.tank_hold.get(id).copied().unwrap_or(false) {
                return;
            }
            if let Some(fid) = ctx.primary_relief.clone() {
                st.relief_stuck.insert(fid.clone(), false);
                st.relief_open.insert(fid.clone(), false);
                st.relief_auto.insert(fid, false);
            }
        }
        "sg" => {
            st.sgtr = false;
        }
        _ => {}
    }
}

/// `srand`: mulberry32 verbatim (`src/sim/rng.js` — `Math.imul` throughout,
/// bit-identical across engines by construction).
pub fn srand_next(rng: &mut i32) -> f64 {
    *rng = rng.wrapping_add(0x6D2B79F5u32 as i32);
    let mut t = *rng;
    // `>>>` zero-fills: cast through u32 first (`>>` on i32 sign-extends).
    t = (t ^ ((t as u32 >> 15) as i32)).wrapping_mul(t | 1);
    t ^= t.wrapping_add((t ^ ((t as u32 >> 7) as i32)).wrapping_mul(t | 61));
    ((t ^ ((t as u32 >> 14) as i32)) as u32) as f64 / 4294967296.0
}

/// `hurtStep`: over the limit by a span, for a time constant.
pub fn hurt_step(h: f64, over: f64, tau: f64, dt: f64) -> (f64, bool) {
    if !(over > 0.0) {
        return (h, false);
    }
    let h2 = h + js_min(over, 1.0) * dt / tau;
    if h2 < 1.0 {
        (h2, false)
    } else {
        (0.0, true)
    }
}

/// `book(s,name,kg)`: kg out of the plant, by name (negative feeds it).
pub fn book(out: &mut std::collections::HashMap<String, f64>, name: &str, kg: f64) {
    if kg != 0.0 {
        *out.entry(name.to_string()).or_insert(0.0) += kg;
    }
}

/// `ledgerOut`: sum of the out book.
pub fn ledger_out(out: &std::collections::HashMap<String, f64>) -> f64 {
    out.values().sum()
}

/// `ledgerOut` in JS insertion order (the gate dumps keys in stream order;
/// float summation is order-sensitive at the ulp level).
pub fn ledger_out_ordered(order: &[String], out: &std::collections::HashMap<String, f64>) -> f64 {
    order.iter().map(|k| out.get(k).copied().unwrap_or(0.0)).sum()
}

/// JS `Math.sign`: NaN in, NaN out, signed zeros preserved.
#[inline]
pub fn js_sign(v: f64) -> f64 {
    if v.is_nan() {
        f64::NAN
    } else if v > 0.0 {
        1.0
    } else if v < 0.0 {
        -1.0
    } else {
        v
    }
}

/// Field bag: `{v, has}` holder (`pfNew`), resolved off the dumped net.
#[derive(Clone, Default)]
pub struct Bag {
    pub v: Vec<f64>,
    pub has: Vec<u8>,
}

impl Bag {
    pub fn get(&self, i: usize) -> Option<f64> {
        if i < self.has.len() && self.has[i] != 0 {
            Some(self.v[i])
        } else {
            None
        }
    }
    pub fn set(&mut self, i: usize, v: f64) {
        if i < self.v.len() {
            self.v[i] = v;
            self.has[i] = 1;
        }
    }
}

/// Structural net lookup for field readers: name→index, vapour mask.
pub struct NetIdx {
    pub index: std::collections::HashMap<String, usize>,
    pub vapour: Vec<u8>,
    pub n: usize,
}

impl NetIdx {
    pub fn pos(&self, nid: &str) -> Option<usize> {
        self.index.get(nid).copied()
    }
}

/// Per-circuit saturation curves + circuit graph facts the field readers
/// need (`satOfCirc`, `circOfNode`, `circAuthored`, `circSetP` resolved by
/// the dumper; `SAT_WATER` is circuit index `usize::MAX`).
pub struct Circuits {
    /// Curve per circuit id (direct index; missing → water fallback).
    pub curves: Vec<Option<Curve>>,
    /// `circOfNode` per net node position.
    pub circ_of: Vec<i32>,
    /// `circAuthored` per circuit id.
    pub authored: Vec<bool>,
    /// `circSetP` (hold setpoint) per circuit id.
    pub set_p: Vec<f64>,
    /// `coreCircs[ci] === 1` per circuit id.
    pub core_circs: Vec<bool>,
    /// Water fallback curve.
    pub water: Curve,
    /// `P.P0`, `P.Pcont`, `P.Tref` fallbacks.
    pub p0: f64,
    pub pcont: f64,
    pub tref: f64,
}

impl Circuits {
    pub fn of(&self, ci: i32) -> &Curve {
        if ci >= 0 {
            if let Some(Some(c)) = self.curves.get(ci as usize) {
                return c;
            }
        }
        &self.water
    }
}

/// `netPAt`: floored at `COND_P0`; an uncarried node reads its circuit's
/// setpoint (`circSetP`), else `s.P`, else `P.P0`.
pub fn net_p_at(
    cx: &CircCtx,
    p_by: &Bag,
    nid: &str,
    s_p: f64,
    cond_p0: f64,
) -> f64 {
    if let Some(i) = cx.net.pos(nid) {
        if let Some(v) = p_by.get(i) {
            return js_max(cond_p0, v);
        }
    }
    let ci = cx.circ_of(nid);
    let c = if ci == i32::MIN { 0.0 } else { cx.set_p(ci) };
    js_max(cond_p0, if c > 0.0 { c } else { s_p })
}

/// `netHAt`: field value, else loop mean on authored circuits, else
/// saturated steam/liquid off the node's own pressure.
pub fn net_h_at(
    cx: &CircCtx,
    h_by: &Bag,
    nid: &str,
    tavg: &dyn Fn(i32) -> f64,
    h_of_t: &dyn Fn(&Curve, f64) -> f64,
    p_at: f64,
) -> f64 {
    if let Some(i) = cx.net.pos(nid) {
        if let Some(v) = h_by.get(i) {
            return v;
        }
    }
    let ci = cx.circ_of(nid);
    let c = cx.cx.of(ci);
    if cx.authored(ci) {
        return h_of_t(c, tavg(ci));
    }
    if cx.vapour(nid) {
        crate::eos::sat_hg(c, p_at)
    } else {
        h_of_t(c, crate::eos::sat_t(c, p_at))
    }
}

/// Bundled read context for the field readers (bags + structure).
pub struct CircCtx<'a> {
    pub net: &'a NetIdx,
    pub cx: &'a Circuits,
    pub circ_of_node: &'a dyn Fn(&str) -> i32,
}

impl<'a> CircCtx<'a> {
    pub fn circ_of(&self, nid: &str) -> i32 {
        (self.circ_of_node)(nid)
    }
    pub fn authored(&self, ci: i32) -> bool {
        ci >= 0 && (self.cx.authored.get(ci as usize).copied().unwrap_or(false))
    }
    pub fn set_p(&self, ci: i32) -> f64 {
        if ci == i32::MIN {
            return 0.0;
        }
        self.cx.set_p.get(ci as usize).copied().unwrap_or(0.0)
    }
    pub fn vapour(&self, nid: &str) -> bool {
        self.net.pos(nid).map(|i| self.net.vapour.get(i).copied().unwrap_or(0) != 0).unwrap_or(false)
    }
}

/// `pfAt` over a dumped bag + dumped index map.
pub fn pf_at(bag: &Bag, net: &NetIdx, nid: &str) -> Option<f64> {
    net.pos(nid).and_then(|i| bag.get(i))
}

/// `regionPMean`: mean gauge kPa per region over the dumped `of` map.
pub fn region_p_mean(of: &[i32], room_p: &[f64], n_regions: usize) -> Vec<f64> {
    let mut m = vec![0.0; n_regions];
    let mut cnt = vec![0u32; n_regions];
    for (i, &r) in of.iter().enumerate() {
        if r < 0 {
            continue;
        }
        if let (Some(mm), Some(cc)) = (m.get_mut(r as usize), cnt.get_mut(r as usize)) {
            *mm += room_p.get(i).copied().unwrap_or(0.0);
            *cc += 1;
        }
    }
    for r in 0..n_regions {
        if cnt[r] != 0 {
            m[r] /= cnt[r] as f64;
        }
    }
    m
}

/// `regionP`: absolute MPa = `Pcont` + region mean/1000; off-grid or
/// regionless reads the base.
pub fn region_p(of: &[i32], means: &[f64], pcont: f64, gw: usize, gh: usize, x: i32, y: i32) -> f64 {
    if x < 0 || y < 0 || x >= gw as i32 || y >= gh as i32 {
        return pcont;
    }
    let r = of.get((y as usize) * gw + (x as usize)).copied().unwrap_or(-1);
    if r < 0 {
        return pcont;
    }
    pcont + means.get(r as usize).copied().unwrap_or(0.0) / 1000.0
}

/// `matCellDP`: wall-cell differential MPa off the dumped liquid/gas grids.
pub fn mat_cell_dp(
    of: &[i32],
    room_p: &[f64],
    room_water: &[f64],
    room_wp: &[f64],
    room_pool: &[f64],
    room_pool_p: &[f64],
    gw: usize,
    gh: usize,
    x: i32,
    y: i32,
) -> f64 {
    let cell_p = |cx: i32, cy: i32| -> Option<f64> {
        if cx < 0 || cy < 0 || cx >= gw as i32 || cy >= gh as i32 {
            return None;
        }
        let i = (cy as usize) * gw + (cx as usize);
        if of.get(i).copied().unwrap_or(-1) < 0 {
            return None;
        }
        let w = room_water.get(i).copied().unwrap_or(0.0);
        let pl = room_pool.get(i).copied().unwrap_or(0.0);
        let a = if w > 0.0 { room_wp.get(i).copied().unwrap_or(f64::NEG_INFINITY) } else { f64::NEG_INFINITY };
        let b = if pl > 0.0 { room_pool_p.get(i).copied().unwrap_or(f64::NEG_INFINITY) } else { f64::NEG_INFINITY };
        let c = if w > 0.0 || pl > 0.0 { f64::NEG_INFINITY } else { room_p.get(i).copied().unwrap_or(f64::NEG_INFINITY) };
        Some(js_max(a, js_max(b, c)))
    };
    let mut hi = f64::NEG_INFINITY;
    let mut lo = f64::INFINITY;
    let mut n = 0u32;
    for (dx, dy) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
        if let Some(p) = cell_p(x + dx, y + dy) {
            if p > hi {
                hi = p;
            }
            if p < lo {
                lo = p;
            }
            n += 1;
        }
    }
    if n == 0 {
        return 0.0;
    }
    (if n == 1 { js_max(0.0, hi) } else { hi - lo }) / 1000.0
}

/// Exact f64 compare with NaN==NaN (gate tail compares).
#[inline]
pub fn eq_f64_exact(got: f64, want: f64) -> bool {
    got == want || (got.is_nan() && want.is_nan())
}

/// JS `num()/||0`: NaN/0/missing read as zero.
#[inline]
pub fn or0(v: f64) -> f64 {
    if v != 0.0 && !v.is_nan() { v } else { 0.0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn srand_matches_js_sequence() {
        // mulberry32(12345) first three outputs, computed off `src/sim/rng.js`.
        let mut rng = 12345i32;
        let a = srand_next(&mut rng);
        let b = srand_next(&mut rng);
        let c = srand_next(&mut rng);
        assert!((a - 0.9797282677609473).abs() < 1e-15, "{a}");
        assert!((b - 0.3067522644996643).abs() < 1e-15, "{b}");
        assert!((c - 0.484205421525985).abs() < 1e-15, "{c}");
    }

    #[test]
    fn srand_matches_js_large_seed() {
        // gate seed 179215642, computed off `src/sim/rng.js` (node).
        let mut rng = 179215642i32;
        let want = [
            0.3037860963959247,
            0.814077548449859,
            0.017826512223109603,
            0.9535749477799982,
            0.9307010469492525,
        ];
        for w in want {
            let a = srand_next(&mut rng);
            assert!((a - w).abs() < 1e-15, "{a} vs {w}");
        }
    }

    #[test]
    fn hurt_step_ramps_and_trips() {
        let (h, t) = hurt_step(0.0, 0.5, 60.0, 0.02);
        assert!(!t && (h - 0.5 * 0.02 / 60.0).abs() < 1e-18);
        let (_, t) = hurt_step(0.9999999, 1.0, 60.0, 0.02);
        assert!(t);
        let (_, t) = hurt_step(0.0, 0.0, 60.0, 0.02);
        assert!(!t);
        let (_, t) = hurt_step(0.0, f64::NAN, 60.0, 0.02);
        assert!(!t);
    }
}
