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
  const PT = M.PT(), IX = M.IX(), ST = M.ST(), SX = M.SX();
  const name = key + (opt.events.length ? "+evt" : "");
  const T = {
    profile: key, name, title: spec.name,
    secs: opt.secs, every: opt.every, seed: opt.seed, dice: opt.dice,
    events: opt.events.map(e => ({t:e.t, kind:e.kind, arg:e.arg})),
    nodes: [], edges: [], samples: []
  };
  for(let i=0;i<PT.n.node;i++) T.nodes.push({
    name: IX.nodeId[i], z: r(PT.nodeZ[i], 3), vol: r(PT.nodeVol[i], 4),
    comp: PT.nodeComp[i], vapour: PT.nodeVapour[i] ? 1 : 0,
    fixed: SX.fixHas[i] ? 1 : 0, at: cellOf(M, IX.nodeId[i])});
  for(let e=0;e<PT.n.edge;e++)
    T.edges.push({u: PT.edU[e], v: PT.edV[e], key: PT.edKey[e] >= 0 ? IX.keyId[PT.edKey[e]] : null, kind: PT.edCk[e]});

  return {
    sample(t){
      const row = {t: r(t,2), p: [], T: [], q: [], on: [], dmg: [], shut: []};
      for(let a=0;a<ST.dmgBy.length;a++) if(ST.dmgBy[a]) row.dmg.push(IX.partId[a]);
      for(let o=0;o<ST.portShut.length;o++) if(ST.portShut[o]) row.shut.push(IX.portId[o]);
      for(let i=0;i<PT.n.node;i++){
        const has = ST.hBy[i] === ST.hBy[i];
        row.p.push(r(ST.pBy[i], 4));
        row.T.push(has ? r(M.eNodeT(i), 1) : null);
      }
      for(let e=0;e<PT.n.edge;e++){
        row.q.push(r(ST.edgeKg[e]/0.02, 4));
        row.on.push(SX.gLive[e] ? 1 : 0);
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
