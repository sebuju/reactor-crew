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
const {ROOT, bundle, scriptPaths} = require('./bundle');
const domstub = require('./domstub');

const EXPORTS = '{commission,step,sample,act,recTick,recRoot,resetPlant,combatHit,'+
  'crSync,dbSync,trSync,trBuild,drawOperate,drawDesign,drawScenario,'+
  'CR:()=>CR,DB:()=>DB,S:()=>S,P:()=>P,LAY:()=>LAY,LOG:()=>LOG,REC:()=>REC,'+
  'TSCALE:()=>TSCALE,plot:()=>plot,togglePlot,sel:()=>sel,setSel:v=>sel=v,'+
  'setScreen:v=>screen=v,layout,SCN:()=>SCN,scnNew,LAYER_ORDER:()=>LAYER_ORDER,'+
  /* Stage 8/7a test hooks: D and CTX are const objects mutated in place, not
     reassigned, but wrapped as getters anyway to match every other "peek at
     internal state" export here (CR, DB, S, P, LAY...) - a bare reference
     would work too, but M.D() reading like the rest of this list is worth
     the one extra character. ctxItemsDesign is a plain function, called the
     same way commission/step/act already are. */
  'D:()=>D,CTX:()=>CTX,ctxItemsDesign,NAME_CAP:()=>NAME_CAP,pipeNetwork,'+
  /* Stage 9 (gauge half) test hooks: place and plumb a spare pump exactly the
     way CONNECT does, then read pumpGauge() straight - the shared primitive
     the PUMP CAPACITY row and, later, the pump panel both build on. */
  'placePart,removePart,addRun,removeRun,pumpGauge}';

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
    /* each strip on ITS OWN screen: trSync() stands down for a strip whose
       screen is not up, so syncing both from 'design' would exercise neither
       and this whole check would go quietly green on nothing. */
    for(const h of strips){ M.setScreen(h.sc); M.trSync(h); }
    M.setScreen('design');
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

/* ══ STAGE 8: partName() IS THE ONLY READER OF A DISPLAY NAME ══
   A source scan, not a runtime one: a raw p.name read is not a throw, it is
   the rail and the mimic quietly disagreeing about a name the first time
   someone renames something - the same failure mode `displayWrites()` below
   exists for. Scoped to the files THIS stage owns; render/plant.js and
   sim/step.js have their own three raw reads, reported, not scanned - see
   .claude/CLAUDE.md's "Known gaps" table for that boundary. Declared here,
   above the main run, so the fault-injection self-test below can reuse it
   against a patched string without re-deriving it. */
const blankOut = t => t.replace(/[^\n]/g,' ');
const stripJsComments = src => src.replace(/\/\*[\s\S]*?\*\//g, blankOut)
                                  .replace(/\/\/[^\n]*/g, blankOut);
const NAME_FILES = ['src/screens/design-bench.js','src/screens/control-room.js',
                     'src/screens/shell.js','src/core/ui.js','src/ui/kit.js'];
function nameReads(override){
  const hits = [];
  for(const f of NAME_FILES){
    const raw = (override && override.f === f) ? override.src
              : fs.readFileSync(path.join(ROOT, f), 'utf8');
    let src = stripJsComments(raw.replace(/^.*DEFAULT NAME:.*$/gm, m => blankOut(m)));
    // partName()'s own fallback read is the one authorised p.name - blank
    // its body out (like a comment) before scanning: the LINE is real, the
    // read inside it is the reason the rule can exist at all.
    src = src.replace(/function partName\([^)]*\)\{[^}]*\}/, m => blankOut(m));
    /* The rename box is the second: its placeholder and its tip must show the
       DEFAULT, or "blank uses X" would quote the name you are replacing. A
       line carrying the tag opts out and says why, the same way a surviving
       .k read carries // LABEL: or // DEFAULT:. */
    const re = /\b(p|part|who)\.name\b/g;
    let m;
    while((m = re.exec(src))) hits.push(f + ':' + src.slice(0, m.index).split('\n').length);
  }
  return hits;
}

/* ══ STAGE 8: THE NAME CAP, AND THE RAIL TITLE IT PROTECTS ══
   .kit-rule-head is plain HTML textContent - domstub has no CSS, no
   scrollWidth, nothing hostReport() already measures. So this ESTIMATES the
   rendered width the same way domstub's own canvas recorder does (wOf() in
   domstub.js): 0.60em per glyph plus the rule's letter-spacing. --t9 is
   11px (style.css), .kit-rule-head's letter-spacing is 1.8px (kit.css), the
   rail is 340px in both screens and 10px padding either side leaves a
   320px run (the stage brief measured this against the real CSS). */
const NAME_FONT_PX = 11, NAME_SP_PX = 1.8, NAME_RUN_PX = 320;
const estWidth = s => s.length * (0.60*NAME_FONT_PX + NAME_SP_PX);
function nameCapAudit(M){
  M.commission(); M.setScreen('design'); M.dbSync();
  const D = M.D(), rail = M.DB().rail;
  // domstub's textContent is a flat property, not a real aggregate - rule()
  // writes the visible text onto its own inner <span>, not onto the head div
  // itself, so the span is what has to be read.
  const heads = () => [...rail.querySelectorAll('.kit-rule-head')].map(h => (h.children[0]&&h.children[0].textContent)||'');
  const before = heads();
  D.name = D.name || {};
  D.name.core = 'A VERY LONG COMPONENT NAME NOBODY SHOULD EVER TYPE INTO THIS BOX';
  M.dbSync();
  const afterLong = heads();
  const i = afterLong.findIndex((t,k) => t !== before[k]);
  const shownLong = i>=0 ? afterLong[i] : null;
  D.name.core = '   ';                          // whitespace-only: still blank
  M.dbSync();
  const shownBlank = i>=0 ? heads()[i] : null;
  return {shownLong, shownBlank, defaultName: i>=0 ? before[i] : null, cap: M.NAME_CAP()};
}
const capOk = r => !!r.shownLong && r.shownLong.length <= r.cap && estWidth(r.shownLong) <= NAME_RUN_PX;
const blankOk = r => !!r.shownBlank && r.shownBlank === r.defaultName;

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

  /* a layer with no switch on the rail has no way to be turned off, so both
     rails must carry exactly one per entry in the registry - not more (a
     leftover from a deleted layer), not fewer (a layer nobody can reach). */
  {
    const want = wide.M.LAYER_ORDER().length;
    const crN = wide.M.CR().rail.querySelectorAll('.layer-switch').length;
    const dbN = wide.M.DB().rail.querySelectorAll('.layer-switch').length;
    add('every layer has a switch, on both rails', crN===want && dbN===want,
        'control room: '+crN+'/'+want+' switches, design bench: '+dbN+'/'+want);
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

  /* the 'damage' step above hit rods and pump1 and never repaired them, so a
     reachable card must still be on screen carrying the two numbers the
     estimated-job-dose promise depends on: the live field rate beside it and
     the dose that job will cost, per the "a control must display the number
     it causes" rule. */
  {
    const cards = [...wide.M.CR().dmgList.querySelectorAll('.cr-dmg-card')]
      .filter(c => !c.classList.contains('blocked'));
    const withDose = cards.filter(c => {
      const d = c.querySelector('.cr-dmg-dose');
      return d && /x FIELD/.test(d.textContent) && /% JOB/.test(d.textContent);
    });
    add('a damage card carries its dose figure', cards.length > 0 && withDose.length === cards.length,
        cards.length ? withDose.length+'/'+cards.length+' reachable damage card(s) show a field rate and a job dose estimate'
                     : 'no reachable damage cards were on screen to check');
  }

  {
    const hits = nameReads(null);
    add('partName() is the only reader of a display name', hits.length === 0,
        hits.length ? hits.length+' raw part-name read(s) - use partName()'
                    : NAME_FILES.length+' owned files read a display name only through partName()',
        hits.map(h => '  ' + h));
  }

  {
    const {M} = boot(null, {box:{width:320, height:190}});
    const r = nameCapAudit(M);
    add('a long name is capped and fits the rail title', capOk(r),
        r.shownLong ? 'renamed head shows '+r.shownLong.length+' char(s), ~'+estWidth(r.shownLong).toFixed(0)+
                      'px estimated (cap '+r.cap+', usable run '+NAME_RUN_PX+'px)'
                    : 'the REACTOR rail title never changed after D.name.core was set - rename is not live-synced');
    add('a blank name falls back to the default title', blankOk(r),
        r.shownBlank ? 'blank name shows "'+r.shownBlank+'"'+(blankOk(r)?' (the default)':' - NOT the default "'+r.defaultName+'"')
                     : 'no rail title to check');
  }

  /* ══ STAGE 7A: A RIGHT-CLICK'S REMOVE OFFER BELONGS TO WHAT IS UNDER IT ══
     ctxItemsDesign() is a pure function of the resolved hit - so it is
     called directly with hand-built hit objects rather than reconstructing
     a page-space point through the VIEW transform. */
  {
    const {M} = boot(null, {box:{width:320, height:190}});
    M.commission();
    const emptyItems = M.ctxItemsDesign({part:null,fitting:null,tapKey:null,tapT:null,runRid:null,port:null,cell:{gx:0,gy:0}});
    const emptyHasRemove = emptyItems.some(it => /^REMOVE\b/.test(it.label));
    add('empty space offers no REMOVE', !emptyHasRemove,
        emptyHasRemove ? 'REMOVE offered with nothing under the cursor: '+emptyItems.map(i=>i.label).join(', ')
                       : emptyItems.length+' item(s) offered, none REMOVE');

    const contP = M.LAY().parts.find(p => p.id === 'cont');
    const contItems = contP ? M.ctxItemsDesign({part:contP,fitting:null,tapKey:null,tapT:null,runRid:null,port:null,cell:null}) : null;
    add('a fitted component offers exactly one REMOVE', !!contP && contItems.length===1 && contItems[0].label==='REMOVE',
        contP ? '('+(contItems.map(i=>i.label).join(', ')||'none')+')'
              : 'CONTAINMENT is not fitted on the stock plant - cannot check');

    /* A HIT ON A PIPE, which the two cases above never reach: both pass
       tapKey:null, so the whole run-tap branch - throttle, relief valve, tee -
       had no coverage at all. It shipped a call to hasRelief(), which was
       never written, and right-clicking any pipe on the bench threw
       "hasRelief is not defined". That takes the FRAME with it, not just the
       menu: ctxItemsDesign() runs inside the draw (drawCtxMenu -> drawDesign
       -> tick), so the bench stops rendering entirely.

       Asserted as "it returns a usable menu", not as an exact item list - the
       offers legitimately depend on how many loops the plant has. What is
       being checked is that the branch RUNS. */
    const run = M.pipeNetwork().find(r => r.key && r.k === 'hot');
    let tapItems=null, tapErr=null;
    try { tapItems = M.ctxItemsDesign({part:null,fitting:null,tapKey:run&&run.key,tapT:0.5,runRid:null,port:null,cell:null}); }
    catch(e){ tapErr = e.message; }
    add('right-clicking a pipe builds a menu', !!run && !tapErr && !!tapItems && tapItems.length>0,
        tapErr ? 'threw: '+tapErr
               : (run ? tapItems.length+' item(s): '+tapItems.map(i=>i.label).join(', ')
                      : 'no hot run on the stock plant - cannot check'));
  }

  /* ══ STAGE 9 (gauge half): PUMP CAPACITY - INSTALLED VS DELIVERED ══
     netFlowK()'s per-group ceiling (pipenet.js) is invisible without a
     readout that says so: install a second pump and nothing on screen
     moves. The RESULTS panel's PUMP CAPACITY row (layoutStats(), design-
     bench.js) is that readout - checked here as the rendered DOM text, not
     just the function behind it, because a row that always prints the same
     figure twice would still pass a check on pumpGauge() alone.
     The damage-recovery half (losing the pump a spare backs up) is checked
     straight against pumpGauge(dmg) instead of the rendered row: the bench
     has no damage concept and the row is deliberately damage-blind (dmg
     defaults to none) - dmg is there for a LIVE caller, the pump panel this
     stage hands off rather than implements. */
  {
    const {M} = boot(null, {box:{width:320, height:190}});
    M.setScreen('design');
    const rowVal = () => { M.dbSync();
      const row = [...M.DB().rail.querySelectorAll('.insp-stat')]
        .find(r => r.querySelector('.insp-stat-lab').textContent === 'PUMP CAPACITY');
      return row ? row.querySelector('.insp-stat-val').textContent : null;
    };
    M.commission();
    const base = rowVal();
    add('the PUMP CAPACITY row exists', base != null,
        base ? 'renders "'+base+'" on a stock plant' : 'no row titled PUMP CAPACITY in the RESULTS panel');

    const sp = M.placePart(n => ({id:'pumpX'+n, name:'RCP SPARE', w:1, h:1, x:9, y:5,
      col:'#57d38c', tip:'A spare coolant pump.', role:'pump'}));
    const r1 = M.addRun(sp.id,'t','core','b'), r2 = M.addRun(sp.id,'b','sg0','b');
    M.commission();
    const plumbed = rowVal();
    const g3 = M.pumpGauge();
    add('a plumbed spare reports installed > delivered', base != null &&
        g3.installed > g3.delivered + 1e-9 && plumbed !== base,
        'installed '+g3.installed.toFixed(1)+' vs delivered '+g3.delivered.toFixed(1)+
        ' - row now reads "'+plumbed+'" (was "'+base+'")');

    const g4 = M.pumpGauge(['pump0']);
    M.removeRun(r1); M.removeRun(r2); M.removePart(sp.id); M.commission();
    const g5 = M.pumpGauge(['pump0']);
    add('losing the original pump: the spare hands the loop back', g4.delivered >= g3.delivered - 1e-9 &&
        g5.delivered < g4.delivered - 1e-9,
        'pump0 lost: delivered '+g4.delivered.toFixed(1)+' with the spare plumbed in vs '+
        g5.delivered.toFixed(1)+' with none installed');
  }
}

/* ══ VISIBILITY IS A CLASS, NEVER AN INLINE DISPLAY STRING ══
   `el.style.display = ""` does not SHOW an element. It removes the inline
   override and hands the element back to the stylesheet - so an element whose
   stylesheet default is `display:none` stays hidden forever. The alarm stack
   and the MELT/TRIP banner both sat in that state, in a project with four green
   auditors, because none of them loads a stylesheet: with no CSS, `display:none`
   never applies and the empty string looks exactly right.

   This is a SOURCE rule for that reason - it is the one shape of CSS fault that
   is visible without CSS. KIT.show() toggles `.kit-hide`, every stylesheet rule
   states the SHOWN display, and no screen, renderer or widget writes
   `style.display` at all. Banning the write outright rather than only the empty
   string is deliberate: a literal "block" written over a stylesheet that says
   "flex" is the same bug wearing a value. */
const DISPLAY_FILES = scriptPaths().filter(
  f => /^src\/(screens|render|ui)\//.test(f) && f.endsWith('.js'));
function displayWrites(override){
  const hits = [];
  for(const f of DISPLAY_FILES){
    const raw = (override && override.f === f) ? override.src
              : fs.readFileSync(path.join(ROOT, f), 'utf8');
    const src = stripJsComments(raw);
    const re = /\.style\.display\s*=/g;
    let m;
    while((m = re.exec(src))) hits.push(f + ':' + src.slice(0, m.index).split('\n').length);
  }
  return hits;
}
{
  const hits = displayWrites(null);
  add('visibility is a class, not an inline display', hits.length === 0,
      hits.length ? hits.length+' inline display write(s) - use KIT.show()'
                  : DISPLAY_FILES.length+' screen/renderer/kit files hide through .kit-hide only',
      hits.map(h => '  ' + h));
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
  /* THE ONE THAT SHIPPED. hasRelief() was called from ctxItemsDesign() and
     never written, so right-clicking any pipe on the bench threw and took the
     frame with it. Put the undefined name back and the pipe-menu check must
     go red - it is the only thing that opens that branch. */
  ['a context-menu helper that does not exist', 'right-clicking a pipe builds a menu',
   s => s.replace('function hasRelief(){', 'function hasRelief__gone(){')],
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
  /* The context menu is not built during a screen sync - it is built on a
     right-click - so the three guards above cannot see it. auditRun() hands
     back the PATCHED module, so this one opens the menu on it directly and
     asks whether that throws, which is exactly what the shipped fault did. */
  else if(guard === 'right-clicking a pipe builds a menu'){
    if(r.err) caught = true;
    else try {
      const run = r.M.pipeNetwork().find(q => q.key && q.k === 'hot');
      const items = r.M.ctxItemsDesign({part:null,fitting:null,tapKey:run&&run.key,tapT:0.5,runRid:null,port:null,cell:null});
      caught = !items || !items.length;
    } catch(e){ caught = true; }
  }
  else                                         caught = !r.err && r.hosts.some(h => h.out.length);
  selftest.push([what, guard, caught, caught ? 'caught by "'+guard+'"' : 'SLIPPED PAST "'+guard+'"']);
}

/* the source rule boots nothing, so it proves itself against a patched STRING:
   the exact line that hid the alarm stack, put back. */
{
  const f = 'src/screens/control-room.js';
  const raw = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const bad = raw.replace('KIT.show(h.row,on);', 'h.row.style.display=on?"":"none";');
  const caught = bad !== raw && displayWrites({f, src: bad}).length === 1;
  selftest.push(['the alarm stack hidden by style.display=""',
                 'visibility is a class, not an inline display', caught,
                 caught ? 'caught by "visibility is a class, not an inline display"'
                        : bad === raw ? 'the injection no longer matches the source'
                                      : 'SLIPPED PAST the source scan']);
}

/* Stage 8: a raw p.name read reintroduced - nothing throws and nothing draws
   wrong, so only the source scan can catch it before the rail and the mimic
   quietly disagree about a name. */
{
  const f = 'src/screens/design-bench.js';
  const raw = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const bad = raw.replace('label:"CONNECT TO "+partName(to.part)', 'label:"CONNECT TO "+to.part.name');
  const caught = bad !== raw && nameReads({f, src: bad}).length >= 1;
  selftest.push(['a raw p.name read reintroduced (CONNECT TO)',
                 'partName() is the only reader of a display name', caught,
                 caught ? 'caught by "partName() is the only reader of a display name"'
                        : bad === raw ? 'the injection no longer matches the source'
                                      : 'SLIPPED PAST the source scan']);
}

/* Stage 8: the cap removed from partName() - an over-long name must be
   caught overflowing the rail's estimated run, not merely hoped never to
   happen. */
{
  const src = bundle();
  const patch = s => s.replace('return n?n.slice(0,NAME_CAP):p.name;', 'return n?n:p.name;');
  const patched = patch(src);
  let caught, detail;
  if(patched === src){ caught = false; detail = 'the injection no longer matches the source'; }
  else try{
    const {M} = boot(patch, {box:{width:320, height:190}});
    caught = !capOk(nameCapAudit(M));
    detail = caught ? 'caught by "a long name is capped and fits the rail title"' : 'SLIPPED PAST the cap check';
  }catch(e){ caught = false; detail = 'threw before the check could run: '+e.message; }
  selftest.push(['the name cap removed from partName()',
                 'a long name is capped and fits the rail title', caught, detail]);
}

/* Stage 8: the blank/whitespace fallback removed from partName() - a name
   that trims to nothing must still show the default title. */
{
  const src = bundle();
  const patch = s => s.replace('const n=(D.name&&D.name[p.id]||"").trim();',
                               'const n=(D.name&&D.name[p.id])||"";');
  const patched = patch(src);
  let caught, detail;
  if(patched === src){ caught = false; detail = 'the injection no longer matches the source'; }
  else try{
    const {M} = boot(patch, {box:{width:320, height:190}});
    caught = !blankOk(nameCapAudit(M));
    detail = caught ? 'caught by "a blank name falls back to the default title"' : 'SLIPPED PAST the blank-fallback check';
  }catch(e){ caught = false; detail = 'threw before the check could run: '+e.message; }
  selftest.push(['the blank-name fallback removed from partName()',
                 'a blank name falls back to the default title', caught, detail]);
}

/* Stage 7a: the old hoisted FIT/REMOVE prefix, reintroduced - the actual
   historical bug (a fixed item list built before ctxItemsDesign() ever
   looked at hit). Proves both the empty-space and the exactly-one-REMOVE
   checks would have caught it. */
{
  const src = bundle();
  const patch = s => s.replace('function ctxItemsDesign(hit){',
    'function ctxItemsDesign(hit){\n'+
    '  { const items=fittableList().map(f=>({label:(f.get()?"REMOVE ":"FIT ")+f.label, fn:()=>f.set(!f.get())})); if(items.length) return items; }');
  const patched = patch(src);
  if(patched === src){
    selftest.push(['the old hoisted FIT/REMOVE prefix reintroduced (empty space)',
                   'empty space offers no REMOVE', false, 'the injection no longer matches the source']);
    selftest.push(['the old hoisted FIT/REMOVE prefix reintroduced (a component)',
                   'a fitted component offers exactly one REMOVE', false, 'the injection no longer matches the source']);
  } else try{
    const {M} = boot(patch, {box:{width:320, height:190}});
    M.commission();
    const emptyItems = M.ctxItemsDesign({part:null,fitting:null,tapKey:null,tapT:null,runRid:null,port:null,cell:{gx:0,gy:0}});
    const emptyCaught = emptyItems.some(it => /^REMOVE\b/.test(it.label));
    selftest.push(['the old hoisted FIT/REMOVE prefix reintroduced (empty space)',
                   'empty space offers no REMOVE', emptyCaught,
                   emptyCaught ? 'caught by "empty space offers no REMOVE"' : 'SLIPPED PAST the check']);
    const contP = M.LAY().parts.find(p => p.id === 'cont');
    const contItems = contP ? M.ctxItemsDesign({part:contP,fitting:null,tapKey:null,tapT:null,runRid:null,port:null,cell:null}) : [];
    const compCaught = !(contItems.length===1 && contItems[0].label==='REMOVE');
    selftest.push(['the old hoisted FIT/REMOVE prefix reintroduced (a component)',
                   'a fitted component offers exactly one REMOVE', compCaught,
                   compCaught ? 'caught by "a fitted component offers exactly one REMOVE"' : 'SLIPPED PAST the check']);
  }catch(e){
    selftest.push(['the old hoisted FIT/REMOVE prefix reintroduced (empty space)',
                   'empty space offers no REMOVE', false, 'threw before the check could run: '+e.message]);
    selftest.push(['the old hoisted FIT/REMOVE prefix reintroduced (a component)',
                   'a fitted component offers exactly one REMOVE', false, 'threw before the check could run: '+e.message]);
  }
}

/* Stage 9 (gauge half): pumpGauge() patched to print the installed figure
   twice - the exact failure this readout exists to catch, since it is
   indistinguishable on screen from the ceiling silently doing nothing. */
{
  const src = bundle();
  const patch = s => s.replace(
    'return {installed: totalPumpCap(), delivered, n};',
    'return {installed: totalPumpCap(), delivered: totalPumpCap(), n};');
  const patched = patch(src);
  if(patched === src){
    selftest.push(['pumpGauge() prints installed for delivered too',
                   'a plumbed spare reports installed > delivered', false,
                   'the injection no longer matches the source']);
  } else try{
    const {M} = boot(patch, {box:{width:320, height:190}});
    M.commission();
    const sp = M.placePart(n => ({id:'pumpX'+n, name:'RCP SPARE', w:1, h:1, x:9, y:5,
      col:'#57d38c', tip:'A spare coolant pump.', role:'pump'}));
    M.addRun(sp.id,'t','core','b'); M.addRun(sp.id,'b','sg0','b');
    M.commission();
    const g = M.pumpGauge();
    const caught = !(g.installed > g.delivered + 1e-9);
    selftest.push(['pumpGauge() prints installed for delivered too',
                   'a plumbed spare reports installed > delivered', caught,
                   caught ? 'caught: installed '+g.installed.toFixed(1)+' == delivered '+g.delivered.toFixed(1)+' with a spare plumbed in'
                          : 'SLIPPED PAST the check']);
  }catch(e){
    selftest.push(['pumpGauge() prints installed for delivered too',
                   'a plumbed spare reports installed > delivered', false,
                   'threw before the check could run: '+e.message]);
  }
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
