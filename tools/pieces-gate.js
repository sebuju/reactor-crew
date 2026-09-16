#!/usr/bin/env node
// node tools/pieces-gate.js [--ticks N] — §6.2d gate: pieces + fixed set.
// Real netPieces/netRef/corePieces/netFixed/netBounds/holdLive on every
// preset vs sim-rs pieces-probe replay, BIT-EXACT. Writes
// tools/pieces-baseline.json on pass.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { headless, ROOT } = require('./bundle');

const args = process.argv.slice(2);
const opt = (k, d) => {
  const eq = args.find(a => a.startsWith('--' + k + '='));
  if (eq) return eq.slice(k.length + 3);
  const i = args.indexOf('--' + k);
  return (i >= 0 && i + 1 < args.length) ? args[i + 1] : d;
};
const TICKS = +(opt('ticks', '120'));
const SAMPLE_AT = [1, 40, 80, 119].filter(t => t < TICKS);

const M = headless('{PRE:()=>PLANTPRE,plantPreset,buildLayout,commission,P:()=>P,S:()=>S,step,' +
  'netPieces,corePieces,netRef,netFixed,netBounds,holdLive,holdOnCirc,edgeG,' +
  'netPcont,holdTankIds,drumIds,holdPOf,holdSetP,tankCircuit,tankInField,tankStores,tankP,' +
  'secP,condP,condVacuum,STOREHELD:()=>netStoreHeld,D:()=>D}');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pieces-gate-'));
const fIn = path.join(tmp, 'pieces.bin');
const parts = [];
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v); parts.push(b); };
const i32arr = a => { const b = Buffer.alloc(4 * a.length); for (let i = 0; i < a.length; i++) b.writeInt32LE(a[i], i * 4); parts.push(b); };
const u32arr = a => { const b = Buffer.alloc(4 * a.length); for (let i = 0; i < a.length; i++) b.writeUInt32LE(a[i], i * 4); parts.push(b); };
const f64arr = a => { const b = Buffer.alloc(8 * a.length); for (let i = 0; i < a.length; i++) b.writeDoubleLE(a[i], i * 8); parts.push(b); };
const u8arr = a => parts.push(Buffer.from(a));
const pins = a => { u32(a.length); for (const [i, p] of a) { u32(i); f64arr([p]); } };

const presetNames = [];
let nSamples = 0, nHold = 0;
const presets = [];
for (const k of Object.keys(M.PRE())) {
  M.plantPreset(+k); M.buildLayout(); M.commission();
  const S = M.S(); S.diceOff = true;
  presetNames.push(M.PRE()[k][0]);
  const P = { samples: [] };
  const D = M.D();
  for (let t = 0; t < TICKS; t++) {
    M.step(0.02);
    if (!SAMPLE_AT.includes(t)) continue;
    const net = M.P().net, n = net.n, ne = net.edges.length;
    // Single real netPieces call: its live[] is the replay input. A
    // standalone edgeG pass would consume FLOWG_CHOKE and perturb the call.
    const pc = M.netPieces(net, S);
    const cset = [...M.corePieces(net, S)].sort((a, b) => a - b);
    const ref = M.netRef(net, S);
    const refAnchor = Array.from(ref.anchor), refP0 = Array.from(ref.p0);
    // fixV is never cleared (only the mask is): seed the replay with the
    // holder's pre-call content, stale values and all.
    const preV = net.fixV ? Array.from(net.fixV) : new Array(n).fill(0);
    const fixed = M.netFixed(net, S);
    // Snapshot NOW: fixed IS the shared net.fixF holder, and netBounds()
    // below (plus tankP's internal netFixed) mutates it in place.
    const fxV = Array.from(fixed.v), fxH = Array.from(fixed.has);
    const D2 = D;
    const cont = net.cont.map(i => [i, M.netPcont(net, S, i)]);
    const held = M.STOREHELD() ? 1 : 0;
    const holdPins = M.holdTankIds().map(id => [net.tankNode[id], M.holdPOf(S, id)])
      .filter(([i]) => i !== undefined);
    const drumPins = M.drumIds().map(id => [net.tankNode[id], M.holdSetP(M.tankCircuit(id))])
      .filter(([i]) => i !== undefined);
    const tankPins = [];
    for (const id in net.tankNode) {
      const i = net.tankNode[id];
      if (D2.tanks[id] && D2.tanks[id].hold) continue;
      if (M.tankInField(id)) continue;
      if (M.tankStores(id)) continue;
      tankPins.push([i, M.tankP(S, id)]);
    }
    const secPins = (net.secT || []).map((i, sk) => [i, M.secP(S, net.secTParts[sk])]);
    const condPins = (net.condParts || []).map((id, ck) =>
      [net.condV[ck], M.condP(S)]).filter((x, ck) => M.condVacuum(net.condParts[ck]));
    const bnd = M.netBounds(net, S);
    const storing = [];
    for (const id in net.tankNode)
      if (M.tankStores(id) && !M.tankInField(id)) storing.push(net.tankNode[id]);
    // holdLive cases: every circuit with a hold tank on it.
    const cis = new Set();
    for (const id of M.holdTankIds()) cis.add(M.tankCircuit(id));
    const holds = [];
    for (const ci of cis) {
      const hs = M.holdOnCirc(ci);
      if (!hs.length) continue;
      const seed = net.tankNode[hs[0]];
      if (seed === undefined) continue;
      holds.push([ci, seed, M.holdLive(net, S, ci, pc) ? 1 : 0]);
      nHold++;
    }
    P.samples.push({ live: Array.from(pc.live), of: Array.from(pc.of), npc: pc.n, cset,
      preV, sP: S.P === undefined ? NaN : S.P, p0p: M.P().P0,
      anchor: refAnchor, p0: refP0,
      cont, held, holdPins, drumPins, tankPins, secPins, condPins,
      fxV, fxH,
      storing, bndV: Array.from(bnd.v), bndH: Array.from(bnd.has), holds });
    nSamples++;
  }
  const net = M.P().net;
  P.meta = { n: net.n, ne: net.edges.length,
    eu: net.edges.map(e => e.u), ev: net.edges.map(e => e.v),
    coreNodes: Object.values(net.coreNodes || {}), coreNode: net.coreNode };
  presets.push(P);
}
u32(presets.length);
for (const P of presets) {
  const m = P.meta;
  u32(m.n); u32(m.ne); u32(2);
  u32arr(m.eu); u32arr(m.ev);
  u32(m.coreNodes.length); u32arr(m.coreNodes); u32(m.coreNode);
  u32(P.samples.length);
  for (const s of P.samples) {
    u8arr(s.live); i32arr(s.of); u32(s.npc);
    u32(s.cset.length); i32arr(s.cset);
    f64arr([s.sP]); f64arr([s.p0p]);
    i32arr(s.anchor); f64arr(s.p0);
    f64arr(s.preV);
    pins(s.cont); u32(s.held);
    pins(s.holdPins); pins(s.drumPins); pins(s.tankPins); pins(s.secPins); pins(s.condPins);
    f64arr(s.fxV); u8arr(s.fxH);
    u32(s.storing.length); u32arr(s.storing);
    f64arr(s.bndV); u8arr(s.bndH);
    u32(s.holds.length);
    for (const [, seed, exp] of s.holds) { u32(seed); u32(exp); }
  }
}
fs.writeFileSync(fIn, Buffer.concat(parts));

const out = execFileSync('cargo', ['run', '--quiet', '--release', '--manifest-path',
  path.join(ROOT, 'sim-rs', 'Cargo.toml'), '--bin', 'pieces-probe', '--', fIn],
  { cwd: ROOT, encoding: 'utf8' });
console.log(out.trim());
const pass = /FAILURES=0/.test(out);
if (pass) {
  fs.writeFileSync(path.join(ROOT, 'tools', 'pieces-baseline.json'), JSON.stringify({
    presets: presetNames, ticks: TICKS, samples: nSamples, holdCases: nHold,
  }, null, 1) + '\n');
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(pass ? 0 : 1);
