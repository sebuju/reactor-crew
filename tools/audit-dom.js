#!/usr/bin/env node
// Usage:  node tools/audit-dom.js
/* THE HTML SCREENS, ACTUALLY RUN.

   The other three auditors execute the plant and read the source. None of them
   has ever executed a screen: they hand the bundle a document with no
   `documentElement`, so crBuild()/dbBuild() bail and every rail, panel, widget
   and hosted canvas is skipped. This one gives it a real one (tools/domstub.js)
   and asks four questions of what comes up.

     IT RUNS.        Build both screens, fly a plant through power, a scram,
                     damage and a blackout, and select every component in turn.
                     A widget reading a constant that was deleted, or a field of
                     P that does not exist, is a hard throw here and nothing at
                     all to the other three.

     IT SITS STILL.  "Screens build DOM once and sync only what changed" is a
                     documented rule that nothing checked. Sync a hundred times
                     and count the elements made: the answer has to be zero.

     IT DRAWS.       A canvas hosted in a rail is invisible to every existing
                     check. If one silently draws nothing, the panel is simply
                     empty and looks deliberate. Each must produce primitives.

     IT STAYS IN.    A hosted widget lays itself out against the box it is
                     handed, and the rail width is the player's to change. Every
                     string it draws must land inside that box - checked at two
                     widths, because a widget that only fits at one is a widget
                     that will not fit at the player's.

   WHAT IT CANNOT DO is say whether any of it looks right. There is no CSS here.
   Everything below is arithmetic, and the browser is still the only thing that
   can answer the other question. */
const fs = require('fs'), path = require('path');
const {ROOT, bundle} = require('./bundle');
const domstub = require('./domstub');

const EXPORTS = '{commission,step,sample,act,recTick,recRoot,resetPlant,combatHit,'+
  'crSync,dbSync,trSync,trBuild,drawOperate,drawDesign,drawScenario,'+
  'CR:()=>CR,DB:()=>DB,S:()=>S,P:()=>P,LAY:()=>LAY,LOG:()=>LOG,REC:()=>REC,'+
  'TSCALE:()=>TSCALE,plot:()=>plot,togglePlot,sel:()=>sel,setSel:v=>sel=v,'+
  'setScreen:v=>screen=v,layout,SCN:()=>SCN,scnNew}';

/* One boot. `src` may be patched first - the self-test at the bottom injects
   real faults and re-boots to prove each check can actually go red. */
function boot(patch, opts){
  const dom = domstub.install(opts);
  let src = bundle().replace(
    /layoutMetrics\(\); layout\(\); requestAnimationFrame\(tick\);/, 'layoutMetrics();');
  if(patch) src = patch(src);
  const M = new Function(src + '; return ' + EXPORTS + ';')();
  return {M, dom};
}

/* ── the exercise ──
   One pass over everything a player can put on screen. It is written as a list
   of NAMED steps so a throw can say which one, rather than handing back a stack
   inside a `new Function` and leaving the reader to count lines. */
function exercise(M, dom, o){
  o = o || {};
  const step = (name, fn) => { try{ fn(); }catch(e){ throw new Error(name+': '+e.message); } };
  const run = n => { for(let i=0;i<n;i++){ M.step(0.02); if(M.S().tick%5===0) M.sample(); M.recTick(); } };

  step('commission', () => M.commission());
  step('recRoot', () => M.recRoot());

  const strips = [];
  step('trBuild', () => { strips.push(M.trBuild('operate'), M.trBuild('scenario')); });

  const syncAll = () => {
    M.setScreen('operate'); M.crSync();
    M.setScreen('design');  M.dbSync();
    for(const h of strips) M.trSync(h);
  };

  step('sync at rest', syncAll);
  step('run to power', () => run(300));
  step('sync at power', syncAll);

  /* EVERY component in turn. This is the step that would have caught the
     deleted kit constant: it only threw from a panel carrying a slider, and
     only the component that owns that slider ever builds one. */
  step('select every component', () => {
    for(const p of M.LAY().parts){ M.setSel(p.id); syncAll(); }
    M.setSel('core');
  });

  /* EVERY channel on the trend, one at a time and then all together: the chart
     is a different widget with nothing plotted, with one series and with four. */
  step('every trend channel', () => {
    const start = M.plot().slice();
    for(const k of start) M.togglePlot(k);
    M.setScreen('operate'); M.crSync();                 // nothing plotted
    for(const k of ['pwr','dnbr','tf','rho']){ M.togglePlot(k); M.crSync(); }
  });

  step('scram', () => { M.act('scram'); run(200); syncAll(); });
  step('damage', () => { M.combatHit('rods'); M.combatHit('pump1'); run(100); syncAll(); });
  step('blackout', () => { M.act('blackout', true); run(100); syncAll(); });
  step('boron dump', () => { M.act('boronDump'); run(50); syncAll(); });
  step('bypass every system', () => {
    for(const k of ['rps','rod','porv','runback','efw','bkp']){ M.act('byp',k); syncAll(); }
  });
  step('scenario bench', () => { M.setScreen('scenario'); M.drawScenario(); M.drawScenario(); });

  /* the three full-screen draws, which is what a frame really calls */
  step('drawOperate', () => { M.setScreen('operate'); M.drawOperate(); });
  step('drawDesign',  () => { M.setScreen('design');  M.drawDesign(); });

  if(o.after) step('after', () => o.after(syncAll, strips, run));
  return {syncAll, strips, run};
}

/* ── check 2: it sits still ──
   Counted around a warmed-up sync, so the elements a first pass legitimately
   builds are not charged to it. */
function reuseCost(M, dom, syncAll, n){
  syncAll(); syncAll();               // warm: first pass builds, second settles
  const before = dom.nodeCount();
  for(let i=0;i<n;i++) syncAll();
  return dom.nodeCount() - before;
}

/* ── checks 3 and 4: hosted canvases ──
   A draw is filed under the canvas that received it, so these are per-widget.
   The page canvas (#cv) is excluded: its content is audit-text.js's job and it
   is measured in layout units against the 12..748 margins, not against a box. */
function hostReport(dom, TS){
  const by = new Map();
  for(const d of dom.draws){
    const h = d.host;
    if(!h || h.attrs.id === 'cv') continue;
    if(!by.has(h)) by.set(h, {el:h, n:0, txt:0, out:[], offScale:[], nonFinite:0});
    const r = by.get(h);
    r.n++;
    const box = h.getBoundingClientRect();
    for(const v of [d.x0,d.x1,d.y,d.y1]) if(v !== undefined && !isFinite(v)) r.nonFinite++;
    if(d.kind !== 'txt') continue;
    r.txt++;
    if(!TS.includes(d.size)) r.offScale.push(d.t+' @'+d.size+'px');
    /* a rotated string's box is its own height wide, which this recorder does
       not model - it is measured for overflow on the axis it can see only */
    const pad = 0.75;                 // sub-pixel slack: a right-aligned label lands on the edge
    if(d.rot ? (d.y < -pad || d.y > box.height+pad)
             : (d.x0 < -pad || d.x1 > box.width+pad || d.y < -pad || d.y > box.height+pad))
      r.out.push(d.t+' at '+d.x0.toFixed(1)+'..'+d.x1.toFixed(1)+' x '+d.y.toFixed(1)+
                 ' in '+box.width+'x'+box.height);
  }
  return [...by.values()];
}

/* Which hosted canvases must exist and must paint. Named, so deleting one
   silently is a failure rather than a smaller list. */
const HOSTED = [
  ['db-latplan-canvas', 'the fuel lattice plan'],
  ['insp-viz-rho',      'the reactivity balance'],
  ['cr-trend-canvas',   'the trend chart'],
];

function auditRun(patch, opts){
  const {M, dom} = boot(patch, opts);
  const out = {dom, M, err:null};
  try{
    const {syncAll} = exercise(M, dom);
    out.syncAll = syncAll;
    out.reuse = reuseCost(M, dom, syncAll, 100);
    dom.clearDraws();
    M.setScreen('operate'); M.crSync(); M.drawOperate();
    M.setScreen('design');  M.dbSync(); M.drawDesign();
    out.hosts = hostReport(dom, M.TSCALE());
  }catch(e){ out.err = e; }
  return out;
}

/* ════════════════════ the run ════════════════════ */
const checks = [];
const add = (name, ok, detail, lines) => checks.push([name, ok, detail, lines]);

const wide = auditRun(null, {box:{width:320, height:190}});
add('every screen runs', !wide.err,
    wide.err ? wide.err.message : 'built, synced and drew through power, scram, damage, blackout and every component',
    wide.err ? [wide.err.stack.split('\n').slice(0,4).join('\n')] : null);

if(!wide.err){
  add('screens build DOM once', wide.reuse === 0,
      wide.reuse + ' element(s) made by 100 further syncs of both screens (must be 0)');

  const byCls = c => wide.hosts.filter(h => h.el.classList.contains(c));
  for(const [cls, what] of HOSTED){
    const hs = byCls(cls);
    const drew = hs.length && hs.every(h => h.n > 0);
    add('it draws: '+cls, !!drew,
        hs.length ? hs.length+' canvas(es), '+hs.reduce((a,h)=>a+h.n,0)+' primitives - '+what
                  : 'NO CANVAS with this class was ever painted - '+what);
  }

  const out = wide.hosts.filter(h => h.out.length);
  add('hosted text stays in its box', out.length === 0,
      out.length ? out.length+' widget(s) draw outside the box they were handed'
                 : wide.hosts.reduce((a,h)=>a+h.txt,0)+' string(s) across '+wide.hosts.length+' hosted canvas(es)',
      out.flatMap(h => h.out.map(s => '  '+h.el.className+': '+s)));

  const off = wide.hosts.filter(h => h.offScale.length);
  add('hosted text is on TSCALE', off.length === 0,
      off.length ? off.length+' widget(s) draw at a size the ladder never set' : 'none off the ladder',
      off.flatMap(h => h.offScale.map(s => '  '+h.el.className+': '+s)));

  const nf = wide.hosts.filter(h => h.nonFinite);
  add('no NaN reaches the canvas', nf.length === 0,
      nf.length ? nf.reduce((a,h)=>a+h.nonFinite,0)+' non-finite coordinate(s)' : 'every coordinate finite',
      nf.map(h => '  '+h.el.className+': '+h.nonFinite));

  /* A SECOND WIDTH, because a widget laid out against one box is not the same
     as a widget laid out against the box. The rail is resizable and a label
     that only fits at 320 will not fit at 220. */
  const narrow = auditRun(null, {box:{width:210, height:150}});
  const nOut = narrow.err ? null : narrow.hosts.filter(h => h.out.length);
  add('and again at a narrower rail', !narrow.err && nOut.length === 0,
      narrow.err ? narrow.err.message
                 : nOut.length ? nOut.length+' widget(s) overflow a 210px rail that fit a 320px one'
                               : 'every hosted string still inside its box at 210px',
      nOut ? nOut.flatMap(h => h.out.map(s => '  '+h.el.className+': '+s)) : null);

  /* the title bar is an input like any other, so it is clicked rather than
     read: a handler that throws is not a handler that works */
  let picked = null;
  try{
    wide.M.setScreen('operate'); wide.M.crSync();
    const heads = wide.M.CR().compRail.querySelectorAll('.kit-rule-pick');
    if(heads.length){ wide.M.setSel('core'); heads[heads.length-1].fire('click');
                      picked = wide.M.sel(); }
    add('a title bar picks its component', heads.length > 0 && picked !== null && picked !== 'core',
        heads.length ? heads.length+' pickable title bar(s); clicking the last selected "'+picked+'"'
                     : 'no title bar carries .kit-rule-pick');
  }catch(e){ add('a title bar picks its component', false, 'threw: '+e.message); }
}

/* every id the stub answers must be an id index.html really has, or the stub is
   propping up a lookup that returns null in a browser */
{
  const html = fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const missing = domstub.install({}).IDS.filter(id => !html.includes('id="'+id+'"'));
  add('the stub invents no elements', missing.length === 0,
      missing.length ? 'not in index.html: '+missing.join(', ')
                     : 'every stubbed id exists in index.html');
}

/* ════════════════════ THE CHECKS HAVE BEEN SEEN TO FAIL ════════════════════
   A check that has never gone red is a check nobody has any reason to believe.
   Each fault below is a REAL one patched into the real source - the two that
   actually happened, plus a rebuild-every-frame - and the named check must
   catch it. If an injection stops biting, the check it proves has gone blind
   and this says so rather than the suite quietly getting easier. */
const FAULTS = [
  ['a deleted kit constant', 'every screen runs',
   s => s.replace('const clampPct = t =>', 'const clampPct__gone = t =>')],
  ['a readout reading a field P has not', 'every screen runs',
   s => s.replace('const beta=P?P.BETA*1e5:650;', 'const beta=P?P.notAField.x:650;')],
  ['a rail rebuilt every sync', 'screens build DOM once',
   s => s.replace('function crRailSync(panels){',
                  'function crRailSync(panels){ KIT.el("div","leak");')],
  ['a hosted label drawn outside its box', 'hosted text stays in its box',
   s => s.replace('txt("REACTIVITY BALANCE",L,y+8,', 'txt("REACTIVITY BALANCE",L,y-400,')],
];
const selftest = [];
for(const [what, guard, patch] of FAULTS){
  const src = bundle();
  const patched = patch(src);
  if(patched === src){ selftest.push([what, guard, false, 'the injection no longer matches the source']); continue; }
  const r = auditRun(patch, {box:{width:320, height:190}});
  let caught;
  if(guard === 'every screen runs')            caught = !!r.err;
  else if(guard === 'screens build DOM once')  caught = !r.err && r.reuse !== 0;
  else                                         caught = !r.err && r.hosts.some(h => h.out.length);
  selftest.push([what, guard, caught, caught ? 'caught by "'+guard+'"' : 'SLIPPED PAST "'+guard+'"']);
}

/* ════════════════════ report ════════════════════ */
let bad = 0;
console.log('=== THE HTML SCREENS, ACTUALLY RUN ===');
for(const [n, ok, detail, lines] of checks){
  console.log((ok?'  ok   ':'  FAIL ') + n.padEnd(32) + detail);
  if(!ok){ bad++; for(const l of (lines||[])) console.log('       ' + l); }
}
console.log('\n=== AND THE CHECKS HAVE BEEN SEEN TO FAIL ===');
for(const [what, , caught, detail] of selftest){
  console.log((caught?'  ok   ':'  FAIL ') + ('inject: '+what).padEnd(46) + detail);
  if(!caught) bad++;
}
console.log(bad ? `\n${bad} failure(s)` : '\nall screen checks pass');
process.exit(bad ? 1 : 0);
