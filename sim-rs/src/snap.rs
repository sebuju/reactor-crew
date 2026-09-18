//! The state half of the ingest format, written: field for field the inverse
//! of `ingest::read_state`. Maps Rust holds unordered go out key-sorted,
//! exactly as `SIMSTATE.state` writes them.
use crate::step::*;
use crate::tick::{Bag, DmgCore};
use crate::{core, events, room, sec};
use std::collections::HashMap;

#[derive(Default)]
pub struct Wr {
    pub b: Vec<u8>,
}

impl Wr {
    pub fn u8(&mut self, v: u8) {
        self.b.push(v);
    }
    pub fn b(&mut self, v: bool) {
        self.b.push(v as u8);
    }
    pub fn u32(&mut self, v: u32) {
        self.b.extend_from_slice(&v.to_le_bytes());
    }
    pub fn i32(&mut self, v: i32) {
        self.b.extend_from_slice(&v.to_le_bytes());
    }
    pub fn f64(&mut self, v: f64) {
        self.b.extend_from_slice(&v.to_le_bytes());
    }
    pub fn str(&mut self, s: &str) {
        self.u32(s.len() as u32);
        self.b.extend_from_slice(s.as_bytes());
    }
    pub fn f64a(&mut self, a: &[f64]) {
        for &v in a {
            self.f64(v);
        }
    }
    pub fn f64an(&mut self, a: &[f64]) {
        self.u32(a.len() as u32);
        self.f64a(a);
    }
    pub fn u8a(&mut self, a: &[u8]) {
        self.b.extend_from_slice(a);
    }
    pub fn u8an(&mut self, a: &[u8]) {
        self.u32(a.len() as u32);
        self.u8a(a);
    }
    pub fn strsn(&mut self, a: &[String]) {
        self.u32(a.len() as u32);
        for s in a {
            self.str(s);
        }
    }
}

fn sorted<'a, V>(m: impl IntoIterator<Item = (&'a String, &'a V)>) -> Vec<(&'a String, &'a V)> {
    let mut v: Vec<(&String, &V)> = m.into_iter().collect();
    v.sort_by(|a, b| a.0.cmp(b.0));
    v
}

fn f64_kv(w: &mut Wr, m: &HashMap<String, f64>) {
    w.u32(m.len() as u32);
    for (k, &v) in sorted(m) {
        w.str(k);
        w.f64(v);
    }
}

fn bool_kv(w: &mut Wr, m: &HashMap<String, bool>) {
    w.u32(m.len() as u32);
    for (k, &v) in sorted(m) {
        w.str(k);
        w.b(v);
    }
}

fn str_kv(w: &mut Wr, m: &HashMap<String, String>) {
    w.u32(m.len() as u32);
    for (k, v) in sorted(m) {
        w.str(k);
        w.str(v);
    }
}

/// `read_f64map` layout: keys then values.
fn f64map(w: &mut Wr, m: &HashMap<String, f64>) {
    let kv = sorted(m);
    w.u32(kv.len() as u32);
    for (k, _) in &kv {
        w.str(k);
    }
    for (_, &v) in &kv {
        w.f64(v);
    }
}

fn mass_out(w: &mut Wr, m: &HashMap<String, f64>, order: &[String]) {
    w.u32(order.len() as u32);
    for k in order {
        w.str(k);
    }
    for k in order {
        w.f64(m.get(k).copied().unwrap_or(f64::NAN));
    }
    w.strsn(order);
}

fn smap(w: &mut Wr, m: &sec::SMap) {
    w.u32(m.keys.len() as u32);
    for k in &m.keys {
        w.str(k);
    }
    w.f64a(&m.vals);
}

fn bags(w: &mut Wr, m: &HashMap<String, Bag>) {
    w.u32(m.len() as u32);
    for (k, b) in sorted(m) {
        w.str(k);
        w.f64an(&b.v);
        w.u8an(&b.has);
    }
}

pub fn sec_state(w: &mut Wr, s: &sec::SecState, meta: &sec::SecMeta, core_ids: &[String]) {
    f64_kv(w, &s.f64s);
    bool_kv(w, &s.u8s);
    str_kv(w, &s.strings);
    w.u32(s.maps.len() as u32);
    for (k, m) in sorted(&s.maps) {
        w.str(k);
        smap(w, m);
    }
    w.u32(s.bmaps.len() as u32);
    for (k, m) in sorted(&s.bmaps) {
        w.str(k);
        w.u32(m.keys.len() as u32);
        for x in &m.keys {
            w.str(x);
        }
        w.u8a(&m.vals);
    }
    bags(w, &s.bags);
    let rel: Vec<&String> = meta.relief_ids.iter().filter(|id| s.relief.contains_key(*id)).collect();
    w.u32(rel.len() as u32);
    for id in rel {
        let c = &s.relief[id];
        w.str(id);
        for v in [c.open, c.auto, c.stuck, c.arm, c.blocked] {
            w.b(v);
        }
    }
    let cores: Vec<&String> = core_ids.iter().filter(|id| s.cores.contains_key(*id)).collect();
    w.u32(cores.len() as u32);
    for id in cores {
        let c = &s.cores[id];
        w.str(id);
        w.f64(c.p_core);
        w.f64(c.flow_net);
    }
    w.strsn(&s.dmg_parts);
    str_kv(w, &s.dmg_why);
    mass_out(w, &s.mass_out, &s.mass_out_order);
    let hb = &s.heatbal;
    for v in [hb.prompt, hb.decay, hb.heat, hb.removal, hb.d_tavg] {
        w.f64(v);
    }
    smap(w, &hb.sg_q_by);
    smap(w, &hb.heat_by);
    w.strsn(&s.pump_live);
    f64_kv(w, &s.net_burst_p);
    w.u32(s.seed);
    w.i32(s.rng);
    w.b(s.dice_off);
    bool_kv(w, &s.tank_byp);
    bool_kv(w, &s.tank_dump);
    w.b(s.ref_open);
    w.f64(s.net_burst_gen);
    for g in [&s.room_p, &s.room_water, &s.room_wp, &s.room_pool, &s.room_pool_p] {
        w.f64an(g);
    }
}

fn dmg_core(w: &mut Wr, c: &DmgCore) {
    w.b(c.breach);
    match &c.trip {
        Some(t) => {
            w.u8(1);
            w.str(t);
        }
        None => w.u8(0),
    }
    w.f64(c.fatigue);
    w.b(c.rod_jam);
    w.f64(c.rod_dem);
    w.f64(c.tilt_dem);
    w.f64an(&c.rod_z_dem);
    w.f64(c.rod_pos);
    w.f64(c.tilt);
    w.f64an(&c.rod_z);
}

pub fn room_state(w: &mut Wr, s: &room::RoomState, core_ids: &[String]) {
    f64_kv(w, &s.f64s);
    bool_kv(w, &s.u8s);
    w.u32(s.i32s.len() as u32);
    for (k, &v) in sorted(&s.i32s) {
        w.str(k);
        w.i32(v);
    }
    w.u32(s.maps.len() as u32);
    for (k, m) in sorted(&s.maps) {
        w.str(k);
        w.u32(m.keys.len() as u32);
        for x in &m.keys {
            w.str(x);
        }
        w.f64a(&m.vals);
    }
    bags(w, &s.bags);
    let cores: Vec<&String> = core_ids.iter().filter(|id| s.cores.contains_key(*id)).collect();
    w.u32(cores.len() as u32);
    for id in cores {
        w.str(id);
        dmg_core(w, &s.cores[id]);
    }
    w.strsn(&s.dmg_parts);
    str_kv(w, &s.dmg_why);
    mass_out(w, &s.mass_out, &s.mass_out_order);
    w.f64(s.burn_kg);
    w.f64(s.burn_p);
    w.f64(s.burn_blast);
    w.strsn(&s.burn_ids);
    w.f64(s.fire_kg);
    w.f64(s.fire_p);
    w.f64(s.fire_q);
    for g in [&s.grids_f64, &s.grids_f32] {
        w.u32(g.len() as u32);
        for (k, v) in sorted(g.iter()) {
            w.str(k);
            w.f64an(v);
        }
    }
}

fn ev_vessel(w: &mut Wr, v: &events::EvVessel) {
    for x in [v.n, v.decay, v.dmg, v.melt_frac] {
        w.f64(x);
    }
    w.f64an(&v.dec);
    for x in [v.tf, v.dnbr, v.vf, v.ox_max, v.q_ox, v.fatigue] {
        w.f64(x);
    }
    w.b(v.scrammed);
    w.b(v.breach);
    w.b(v.melt);
    w.str(&v.trip);
    w.f64(v.rod_pos);
    w.b(v.rod_jam);
    w.b(v.rod_band);
    w.f64(v.rho);
    w.f64(v.parts_xe);
    w.f64(v.tilt);
    w.f64an(&v.rod_z);
    w.f64an(&v.rod_z_dem);
    w.f64(v.tilt_dem);
    w.f64(v.rod_dem);
    w.f64(v.rps_hot);
    w.b(v.rps_near);
}

pub fn events_state(w: &mut Wr, s: &events::EventsState, core_ids: &[String]) {
    w.i32(s.tick);
    for x in [s.n, s.decay, s.heat, s.dmg, s.melt_frac, s.tf, s.dnbr, s.vf, s.ox_max, s.q_ox, s.fatigue] {
        w.f64(x);
    }
    w.b(s.scrammed);
    w.b(s.breach);
    w.b(s.melt);
    w.str(&s.trip);
    w.f64(s.rod_pos);
    w.b(s.rod_jam);
    w.b(s.rod_band);
    w.f64(s.rho);
    w.f64(s.parts_xe);
    for x in [s.p, s.tavg, s.lvl, s.sc, s.cav, s.h2, s.inj_rate, s.release] {
        w.f64(x);
    }
    w.b(s.blackout);
    w.f64(s.load);
    w.f64(s.load_dem);
    w.b(s.bkp_lost);
    w.b(s.sgtr);
    w.f64(s.flow_net);
    w.b(s.turb_trip);
    w.b(s.cond_lost);
    for x in [s.crew_dose, s.dose, s.dose_rate, s.rep_rate] {
        w.f64(x);
    }
    w.b(s.party_spent);
    w.f64(s.mass_res);
    w.f64(s.mass_warn);
    w.i32(s.mass_warn_t);
    for x in [s.room_pmax, s.room_burn_on, s.room_fire_on, s.room_bang, s.room_max, s.spin_v, s.spin_tv] {
        w.f64(x);
    }
    w.u32(s.ann_rev);
    w.b(s.burn_blast);
    w.f64(s.burn_kg);
    w.f64(s.burn_p);
    w.f64(s.fire_kg);
    w.f64(s.fire_p);
    w.f64(s.fire_q);
    w.b(s.repair_present);
    w.f64(s.repair_t);
    w.f64(s.repair_need);
    w.str(&s.repair_id);
    w.f64an(&s.dec);
    w.strsn(&s.burn_ids);
    for g in [&s.room_p, &s.room_t, &s.room_h2, &s.room_m, &s.room_vap] {
        w.f64an(g);
    }
    let ves: Vec<&String> = core_ids.iter().filter(|id| s.vessels.contains_key(*id)).collect();
    w.u32(ves.len() as u32);
    for id in ves {
        w.str(id);
        ev_vessel(w, &s.vessels[id]);
    }
    f64map(w, &s.tank);
    w.u8an(&s.mby_has);
    w.f64an(&s.mby_v);
    mass_out(w, &s.mass_out, &s.mass_out_order);
    w.strsn(&s.dmg_parts);
    str_kv(w, &s.dmg_why);
    f64map(w, &s.room_crush);
    f64map(w, &s.room_hurt);
    f64map(w, &s.flow_pos);
    bool_kv(w, &s.ev);
    w.u32(s.ann_on.len() as u32);
    for (k, &v) in sorted(&s.ann_on) {
        w.str(k);
        w.u8(v);
    }
    for m in [&s.relief_open, &s.relief_blocked, &s.relief_stuck, &s.relief_auto] {
        bool_kv(w, m);
    }
    f64map(w, &s.relief_steam);
    bool_kv(w, &s.sg_burst);
    let mut shut: Vec<String> = s.port_shut.iter().cloned().collect();
    shut.sort();
    w.strsn(&shut);
    for m in [&s.flow_demby, &s.lvl_by, &s.sc_by, &s.tavg_by] {
        f64map(w, m);
    }
}

pub fn core_state(w: &mut Wr, c: &core::CoreState) {
    for a in [&c.phi, &c.x_i, &c.x_x, &c.n_tf, &c.n_tc, &c.n_v, &c.n_rho, &c.n_vt, &c.n_tct,
        &c.n_cov, &c.n_fol, &c.n_dmg, &c.n_ox, &c.n_melt, &c.n_disp, &c.n_dnb, &c.ch_w] {
        w.f64an(a);
    }
    w.f64(c.n);
    w.f64an(&c.c);
    w.f64an(&c.dec);
    w.f64(c.decay);
    w.f64(c.heat);
    w.f64(c.rod_pos);
    w.f64(c.rod_dem);
    w.f64an(&c.rod_z);
    w.f64an(&c.rod_zdem);
    w.f64(c.tilt);
    w.f64(c.tilt_dem);
    for v in [c.split, c.re_gang, c.rod_jam, c.scrammed, c.rod_band] {
        w.b(v);
    }
    for x in [c.dnbr, c.x, c.i, c.tf, c.ao, c.ro, c.hot_ring, c.hot_lev, c.v_node, c.hot_flow,
        c.tip_rho_out, c.tf_hot, c.dmg, c.melt_frac, c.ox_max, c.q_ox, c.fci, c.t_clad_hot,
        c.dnbr_min, c.dnbr_ring, c.dnbr_lev, c.fq, c.vf, c.void_th, c.core_dt] {
        w.f64(x);
    }
    w.f64a(&c.parts);
    w.f64(c.rho);
    w.f64(c.p_core);
    w.f64(c.flow_net);
    w.f64(c.fatigue);
    w.b(c.melt);
    w.b(c.breach);
    w.u8an(&c.n_tube);
    w.f64(c.tubes_open);
    w.b(c.cav_relief);
}

/// The whole state half: stage states, canonical bags, the carried tail and
/// the engine's own carry.
pub fn write_state(w: &mut Wr, meta: &StepMeta, st: &StepState, cy: &Carry) {
    sec_state(w, &st.sec, &meta.sec, &meta.core_ids);
    room_state(w, &st.room, &meta.core_ids);
    events_state(w, &st.events, &meta.core_ids);
    let cores: Vec<&String> = meta.core_ids.iter().filter(|id| st.core.contains_key(*id)).collect();
    w.u32(cores.len() as u32);
    for id in cores {
        w.str(id);
        core_state(w, &st.core[id]);
    }
    for b in [&st.m_by, &st.h_by, &st.p_by, &st.b_by, &st.h2_by, &st.metal] {
        w.f64an(&b.v);
        w.u8an(&b.has);
    }
    w.f64an(&st.blk_out);
    w.f64an(&st.blk_f);
    w.f64(st.tavg);
    w.f64(st.dtavg);
    f64_kv(w, &st.tavg_by);
    f64_kv(w, &st.dtavg_by);
    let fs = &st.solve_carry.fs;
    for a in [&fs.p, &fs.rho, &fs.x, &fs.b, &fs.rho_d, &fs.rho_g, &fs.rho_l] {
        w.f64a(a);
    }
    w.u8a(&fs.wet);
    w.u8a(&fs.void_);
    for a in [&fs.mu, &fs.lp, &fs.lh, &fs.lm] {
        w.f64a(a);
    }
    w.f64a(&st.solve_carry.warr);
    w.f64a(&st.solve_carry.fix_v);
    w.b(st.solve_carry.choke);
    let m = &st.solve_carry.memo;
    for a in [&m.kp, &m.kh, &m.km, &m.p0, &m.cc] {
        w.f64a(a);
    }
    w.u32(cy.pc_of.len() as u32);
    for &v in &cy.pc_of {
        w.i32(v);
    }
    w.u32(cy.pc_n as u32);
    w.u8an(&cy.pc_live);
    w.str(st.solve_carry.div_sig.as_deref().unwrap_or(""));
    let q = &st.room_inj;
    w.b(q.present);
    if q.present {
        w.u8(q.kind);
        w.f64(q.rate);
        w.i32(q.target);
    }
    w.u32(st.room_cg_it);
    w.u32(st.room_pgen);
    w.f64an(&st.room_gsx);
    w.f64an(&st.room_disp);
    w.u32(st.log.len() as u32);
    for e in &st.log {
        w.u8(e.sev);
        w.u32(e.code);
        w.strsn(&e.ids);
    }
    w.u32(st.tick as u32);
    let d = AdvectCache::default();
    let ac = st.advect_cache.as_ref().unwrap_or(&d);
    w.f64an(&ac.feed_hv);
    w.u8an(&ac.feed_hm);
    w.f64an(&ac.feed_mv);
    w.u8an(&ac.feed_mm);
    w.f64an(&ac.core_hv);
    w.u8an(&ac.core_hm);
    w.f64(ac.out_pri);
    w.f64(ac.out_sec);
    w.f64an(&ac.landed);
    w.f64an(&ac.edge_kg);
    w.f64an(&ac.out_kg_v);
    w.u8an(&ac.out_kg_m);
    w.f64an(&ac.out_h2_v);
    w.u8an(&ac.out_h2_m);
    w.str(&cy.pc_sig);
    w.f64(cy.nat_tick as f64);
    w.f64an(&cy.nat_p_v);
    w.u8an(&cy.nat_p_has);
    w.f64an(&cy.nat_loop);
    w.u8an(&cy.fix_mask);
    w.u32(cy.fix_gen as u32);
}
