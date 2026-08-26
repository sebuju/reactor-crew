"use strict";
/* Stage 3b deleted D.loops from src/ - a steam generator is a placed part
   now (ADD STEAM GENERATOR HERE, design-bench.js), wired by hand through
   addRun()/CONNECT, the same as a spare pump. Every auditor that used to
   write `M.D().loops=n` to build an n-loop test plant needs the same real
   mechanism instead of a knob that no longer exists.

   makeLoops(M,n) builds exactly the OLD stock n-loop topology (same ids,
   same positions, same D.run entries buildLayout()/pipeNetwork() used to
   conjure for i<D.loops) through placePart() and a direct D.run write - not
   addRun(), because addRun() always stamps k:"user" and this needs the real
   "hot"/"cold"/"steam"/"feed" labels the pinned figures below were measured
   against. It always resets to loop 0 first (tearing down whatever a PRIOR
   call to this helper built), so repeated calls in one process never leave
   loop 1..3 parts stacking up.

   M must expose D(), placePart(id-maker) and either LAY() or parts() (the
   three shapes the auditors already require from bundle.headless()). */
function makeLoops(M, n){
  const D = M.D();
  const parts = () => (M.LAY ? M.LAY() : {parts: M.parts()}).parts;
  const has = id => parts().some(p => p.id === id);
  for(let i=1;i<=3;i++){
    const sg="sg"+i, pu="pump"+i;
    if(has(sg)) M.removePart(sg);
    if(has(pu)) M.removePart(pu);
    delete D.run["hot"+i]; delete D.run["coldA"+i]; delete D.run["coldB"+i];
    delete D.run["steam"+i]; delete D.run["feedD"+i];
  }
  for(let i=1;i<n;i++){
    M.placePart(() => ({id:"sg"+i, name:"STEAM GEN "+(i+1), w:1, h:2, x:8+i*2, y:1,
      col:"#5fd2e2", grp:"loop"+i, tip:"", role:"sg"}));
    M.placePart(() => ({id:"pump"+i, name:"RCP "+(i+1), w:1, h:1, x:8+i*2, y:6,
      col:"#57d38c", grp:"loop"+i, tip:"", role:"pump"}));
    D.run["hot"+i]  ={a:"core",af:"r",b:"sg"+i,bf:"l",k:"hot",  bore:1};
    D.run["coldA"+i]={a:"sg"+i, af:"b",b:"pump"+i,bf:"t",k:"cold", bore:1};
    D.run["coldB"+i]={a:"pump"+i,af:"b",b:"core",bf:"b",k:"cold", bore:1};
    D.run["steam"+i]={a:"sg"+i, af:"t",b:"turb",bf:"t",k:"steam",bore:1};
    D.run["feedD"+i]={a:"feed",af:null,b:"sg"+i,bf:"b",k:"feed",bore:1};
  }
}
module.exports={makeLoops};
