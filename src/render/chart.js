"use strict";

// o = { title, titleCol,
//       series:[{lab,u,col,n,at:i=>v, style:"line"|"dash"}],
//       n,                       // sample count; defaults to the longest series
//       share,                   // one scale across all series
//       marks:[{f,col,lab}],     // f is 0..1 across the plot
//       xlab:[left,right], empty, ph, k }
/* `k` shrinks every label at once, snapped back onto TSCALE so nothing lands
   between two steps of the documented ladder. It exists because this chart is
   drawn at two scales now: full width on #cv, where a layout unit is about a
   CSS pixel, and inside a rail through hostPaint(), where one unit is HOST_K of
   them - so the same 10 came out half again as big as the HTML type beside it. */
const chSz=(want,k)=>{ const t=want*(k||1);
  for(const s of TSCALE) if(s<=t) return s;
  return TSCALE[TSCALE.length-1]; };
function chart(x,y,w,h,o){
  o=o||{};
  const k=o.k, S9=o.series||[], px=x+10, py=y+24, pw=w-20, ph=o.ph!==undefined?o.ph:h-64;
  if(o.title) well(x,y,w,h,o.title,o.titleCol||C.amber,o.titleO);
  fillRect(px,py,pw,ph,C.well); frame(px,py,pw,ph,C.edge);
  for(let g=1;g<4;g++) fillRect(px,py+ph*g/4,pw,1,"rgba(120,180,190,.06)");
  for(let g=1;g<6;g++) fillRect(px+pw*g/6,py,1,ph,"rgba(120,180,190,.05)");

  let n=o.n; if(n===undefined) n=S9.reduce((m,s)=>Math.max(m,s.n||0),0);
  const live = S9.length && n>=2;

  if(!live){
    txt(o.empty||"COLLECTING DATA",px+pw/2,py+ph/2+4,
        {size:chSz(10,k),sp:2,align:"center",color:C.ink2});
  } else {
    // stepN decimates to at most one sample per pixel column
    const stepN=Math.max(1,Math.ceil(n/pw));
    const scale=s=>{
      let lo=Infinity,hiV=-Infinity;
      for(let i=0;i<n;i+=stepN){ const v=s.at(i); if(v<lo)lo=v; if(v>hiV)hiV=v; }
      return [lo,hiV];
    };
    if(o.share){
      // the flat-line case is handled on the shared range too, or two curves
      // that both sit still land on two different invisible scales
      let lo=Infinity,hiV=-Infinity;
      for(const s of S9){ const [a,b]=scale(s); if(a<lo)lo=a; if(b>hiV)hiV=b; }
      let span=hiV-lo;
      if(span<1e-6){ span=Math.max(Math.abs(hiV)*.2,1); lo-=span/2; }
      else { lo-=span*.08; span*=1.16; }
      for(const s of S9){ s._lo=lo; s._hi=lo+span; }
    } else {
      for(const s of S9){
        const [lo0,hi0]=scale(s);
        let lo=lo0, span=hi0-lo0;
        if(span<1e-6){ span=Math.max(Math.abs(hi0)*.2,1); lo-=span/2; }
        else { lo-=span*.08; span*=1.16; }
        s._lo=lo; s._hi=lo+span;
      }
    }
    for(const s of S9){
      const lo=s._lo, span=s._hi-s._lo;
      ctx.beginPath(); ctx.strokeStyle=s.col; ctx.lineWidth=1.6;
      if(s.style==="dash") ctx.setLineDash([4,3]);
      let first=true;
      for(let i=0;i<n;i+=stepN){
        const X=px+(i/(n-1))*pw, Y=py+ph-((s.at(i)-lo)/span)*ph;
        first?(ctx.moveTo(X,Y),first=false):ctx.lineTo(X,Y);
      }
      ctx.stroke();
      if(s.style==="dash") ctx.setLineDash([]);
    }
  }

  // marks drawn after the curves, clamped inside the plot so f=1 lands on the
  // last pixel rather than on the frame
  for(const m of (o.marks||[])){
    const X=px+clamp(m.f,0,1)*pw;
    fillRect(X,py,1,ph,m.col||C.amber);
    if(m.lab) txt(m.lab,X+3,py+9,{size:chSz(6.5,k),sp:.6,color:m.col||C.amber});
  }

  const xl=o.xlab||[];
  if(xl[0]) txt(xl[0],px+3,py+ph-4,{size:chSz(7,k),color:C.ink2});
  if(xl[1]) txt(xl[1],px+pw-3,py+ph-4,{size:chSz(7,k),align:"right",color:C.ink2});
  return {px,py,pw,ph,live,k};
}

/* `k` rides on the box the chart handed back, so a caller cannot shrink one and
   forget the other and end up with a legend bigger than its own plot.

   ── FOUR COLUMNS IS A QUARTER OF pw, WHATEVER pw IS ──
   Which on a rail-width chart is about 30 units, and "-5437 pcm" does not fit
   in 30 units at any size the ladder has. So the column gives way in a stated
   order, worst-to-least useful:

     the NAME is clipped        - a shortened name is still that name
     the UNIT is dropped        - the label above already said what it is
     the RANGE is dropped       - it only ever qualified the reading

   THE READING ITSELF IS NEVER TRIMMED. A clipped number is a wrong number, and
   this panel exists to be believed. If it will not fit, something else goes. */
function chartLegend(box,y,S9,o){
  o=o||{};
  const k=box.k, cw=box.pw/4, chip=chSz(7.5,k);
  S9.forEach((s,i)=>{
    const lx=box.px+i*cw, room=cw-3;
    fillRect(lx,y,7,7,s.col);
    clipTxt(s.lab,lx+10,y+7,room-10,{size:chip,sp:.9,color:C.ink});

    const cur=s.n?s.at(s.n-1):0, num=cur.toFixed(Math.abs(cur)>=100?0:2);
    const vSize=chSz(10,k), vo={size:vSize,color:s.col};
    const withU=s.u? num+" "+s.u : num;
    const str=tw(withU,vo)<=room ? withU : num;
    txt(str,lx,y+21,vo);

    const left=room-tw(str,vo)-4;
    if(s._lo!==undefined){
      const rng=s._lo.toFixed(0)+" .. "+s._hi.toFixed(0), ro={size:chSz(7.5,k),align:"right",color:C.ink2};
      if(tw(rng,ro)<=left) txt(rng,lx+room,y+21,ro);
    }
  });
}
