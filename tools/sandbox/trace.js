// a script tag, not JSON: fetch does not work on file://, so the viewer loads NETTRACE the way index.html loads the game
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'out');

const r = (v, dp) => (v === null || v === undefined || !isFinite(v)) ? null
                   : Math.round(v*Math.pow(10,dp))/Math.pow(10,dp);

function cellOf(M, nid){
  const p = M.partOf(nid) || M.partOf(nid.slice(0,-1));
  return p ? [p.x, p.y, p.w, p.h] : null;
}

exports.open = (M, key, spec, opt) => {
  const net = M.P().net;
  const name = key + (opt.events.length ? "+evt" : "");
  const s0 = M.S();
  const sol = M.netSolve(net, s0);
  const T = {
    profile: key, name, title: spec.name,
    secs: opt.secs, every: opt.every, seed: opt.seed, dice: opt.dice,
    events: opt.events.map(e => ({t:e.t, kind:e.kind, arg:e.arg})),
    nodes: [], edges: [], samples: []
  };
  for(let i=0;i<net.n;i++) T.nodes.push({
    name: net.name[i], z: r(net.z[i], 3), vol: r(net.vol[i], 4),
    comp: net.comp[i], vapour: net.vapour[i] ? 1 : 0,
    fixed: sol.fixed[i] !== undefined ? 1 : 0, at: cellOf(M, net.name[i])});
  for(const ed of net.edges)
    T.edges.push({u: ed.u, v: ed.v, key: ed.key || null, kind: ed.kind || null});

  return {
    sample(s, t){
      const sol2 = M.netSolve(net, s), P = M.netPressures(s);
      const row = {t: r(t,2), p: [], T: [], q: [], on: [],
                   dmg: (s.dmgParts||[]).slice(),
                   shut: Object.keys(s.portShut||{}).filter(k=>s.portShut[k])};
      for(let i=0;i<net.n;i++){
        const nid = net.name[i];
        row.p.push(P[nid] === undefined ? null : r(P[nid], 4));
        let tv = null; try{ tv = M.netTempAt(s, nid); }catch(e){ tv = null; }
        row.T.push(r(tv, 1));
      }
      for(let e=0;e<net.edges.length;e++){
        const ed = net.edges[e], g = typeof ed.g === "function" ? ed.g(s) : ed.g;
        row.q.push(r(sol2.q[e], 4));
        row.on.push(g > 0 ? 1 : 0);
      }
      T.samples.push(row);
    },
    close(){
      if(!fs.existsSync(OUT)) fs.mkdirSync(OUT, {recursive:true});
      const f = path.join(OUT, name + '.js');
      fs.writeFileSync(f, 'NETTRACE[' + JSON.stringify(name) + '] = '
        + JSON.stringify(T) + ';\n');
      return path.relative(path.join(__dirname, '..', '..'), f).replace(/\\/g, '/');
    }
  };
};
