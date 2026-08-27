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
/* ── A FLAT TRACE HAS TO READ FLAT ──
   Every series gets its own invisible scale, so "how much wobble is none" is
   the whole question. The test was an absolute 1e-6, which no real channel ever
   reaches: fuel temp resting at 903 K breathes in its fourth decimal, and that
   got stretched over the full height of the plot until the noise WAS the
   picture. A thousandth of the magnitude is flat, whatever the magnitude is. */
function chBand(lo,hi){
  const span=hi-lo, mag=Math.max(Math.abs(lo),Math.abs(hi));
  if(span<=Math.max(1e-6,mag*1e-3)){
    const s=Math.max(mag*.2,1), mid=(lo+hi)/2;
    return [mid-s/2, mid+s/2];
  }
  return [lo-span*.08, hi+span*.08];
}
/* THE PLOT FILLS WHAT IS LEFT, and what is left depends on what is drawn.
   `top` is the band above the plot: a titled chart owes well()'s title bar 24
   units, an untitled one owes nothing, and the untitled trend panel was paying
   for a title bar it never drew - a quarter of its height, blank, above a plot
   squeezed into a third of the box. `pad` is the side inset, so a chart hosted
   in an HTML panel can line its frame up with the rows above it instead of
   standing 15 px proud of them. */
function chart(x,y,w,h,o){
  o=o||{};
  const k=o.k, S9=o.series||[];
  const top=o.top!==undefined?o.top:(o.title?24:6), pad=o.pad!==undefined?o.pad:10;
  const px=x+pad, py=y+top, pw=w-2*pad, ph=o.ph!==undefined?o.ph:h-top-40;
  if(o.title) well(x,y,w,h,o.title,o.titleCol||C.amber,o.titleO);
  fillRect(px,py,pw,ph,C.well); frame(px,py,pw,ph,C.edge);
  for(let g=1;g<4;g++) fillRect(px,py+ph*g/4,pw,1,"rgba(120,180,190,.06)");
  for(let g=1;g<6;g++) fillRect(px+pw*g/6,py,1,ph,"rgba(120,180,190,.05)");

  let n=o.n; if(n===undefined) n=S9.reduce((m,s)=>Math.max(m,s.n||0),0);
  const live = S9.length && n>=2;

  /* THE SCALES ARE SETTLED BEFORE ANYTHING IS DRAWN, live or not. A series
     carrying its own `lo`/`hi` is PINNED to them - see CHVIEW in trends.js -
     and a pinned scale is a scale a warning line can be placed on while the
     ring is still filling, which is exactly when an operator wants to see
     where the line is. */
  /* The range is read off EVERY sample, not off the ones the drawing happens
     to land on: a decimated range with an undecimated line lets a spike out
     through the top of the frame. */
  const scale=s=>{
    let lo=Infinity,hiV=-Infinity;
    for(let i=0;i<n;i++){ const v=s.at(i); if(v<lo)lo=v; if(v>hiV)hiV=v; }
    return [lo,hiV];
  };
  const auto=[];
  for(const s of S9){
    if(s.lo!==undefined&&s.hi!==undefined){ s._lo=s.lo; s._hi=s.hi; }
    else auto.push(s);
  }
  if(live&&auto.length){
    if(o.share){
      // the flat-line case is handled on the shared range too, or two curves
      // that both sit still land on two different invisible scales
      let lo=Infinity,hiV=-Infinity;
      for(const s of auto){ const [a,b]=scale(s); if(a<lo)lo=a; if(b>hiV)hiV=b; }
      const [a,b]=chBand(lo,hiV);
      for(const s of auto){ s._lo=a; s._hi=b; }
    } else {
      for(const s of auto){ const [lo0,hi0]=scale(s), [a,b]=chBand(lo0,hi0);
        s._lo=a; s._hi=b; }
    }
  }

  /* THE LINE YOU ARE NOT MEANT TO CROSS, dashed and horizontal, on the first
     series' own scale - which is the only scale on a one-channel chart, and
     the shared one when `share` is set. Drawn under the curves: it is the
     background the trace is read against, never a thing in front of it. */
  const ref=S9[0];
  if(o.hline&&ref&&ref._lo!==undefined&&ref._hi>ref._lo){
    ctx.save(); ctx.setLineDash([3,4]); ctx.lineWidth=1; ctx.globalAlpha=.45;
    for(const L of o.hline){
      const v=typeof L==="number"?L:L.v;
      const t=(v-ref._lo)/(ref._hi-ref._lo);
      if(t<0||t>1) continue;
      const Y=Math.round(py+ph-t*ph)+.5;
      ctx.beginPath(); ctx.moveTo(px,Y); ctx.lineTo(px+pw,Y);
      ctx.strokeStyle=(L&&L.col)||C.red; ctx.stroke();
    }
    ctx.restore();
  }

  if(!live){
    txt(o.empty||"COLLECTING DATA",px+pw/2,py+ph/2+4,
        {size:chSz(10,k),sp:2,align:"center",color:C.ink2});
  } else {
    /* ── ONE COLUMN PER PIXEL, AND IT KEEPS BOTH ENDS ──
       Three minutes of history is ~1800 samples across ~180 units of plot, so
       something has to give. Taking every tenth sample is the cheap answer and
       the wrong one: it ALIASES, and a channel with any ripple on it came out
       as jitter that moved when the ring shifted - the same plant redrawn twice
       gave two different pictures. Each column carries the min and the max of
       the samples inside it instead. A calm trace draws as one line, a busy one
       draws as its envelope, and neither invents a shape the data does not have. */
    const cols=Math.max(2,Math.min(n,Math.floor(pw)));
    for(const s of S9){
      const lo=s._lo, span=s._hi-s._lo, Yof=v=>py+ph-((v-lo)/span)*ph;
      ctx.beginPath(); ctx.strokeStyle=s.col; ctx.lineWidth=1.6;
      if(s.style==="dash") ctx.setLineDash([4,3]);
      for(let c=0;c<cols;c++){
        const i0=Math.floor(c*n/cols), i1=Math.max(i0+1,Math.floor((c+1)*n/cols));
        let mn=Infinity,mx=-Infinity;
        for(let i=i0;i<i1&&i<n;i++){ const v=s.at(i); if(v<mn)mn=v; if(v>mx)mx=v; }
        const X=px+(c/(cols-1))*pw, a=Yof(mn), b=Yof(mx);
        c?ctx.lineTo(X,a):ctx.moveTo(X,a);
        if(b!==a) ctx.lineTo(X,b);
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
  const k=box.k, chip=chSz(6.5,k);
  /* ── ONE SERIES IS ONE LINE ──
     The two-line column exists because four of them have to share the width.
     With a single curve there is nothing to share with, so the name and the
     reading sit on the same baseline and the chart gets the other line of
     height back - which is most of what makes a stack of one-channel charts
     fit where one four-channel chart used to. */
  if(S9.length===1){
    const s=S9[0], vo={size:chSz(8,k),align:"right",color:s.col};
    const cur=s.n?s.at(s.n-1):0, num=cur.toFixed(Math.abs(cur)>=100?0:2);
    const str=s.u? num+" "+s.u : num;
    fillRect(box.px,y,7,7,s.col);
    txt(str,box.px+box.pw,y+7,vo);
    clipTxt(s.lab,box.px+10,y+7,box.pw-10-tw(str,vo)-6,
      {size:chip,sp:.9,color:C.ink});
    return;
  }
  const cw=box.pw/4;
  S9.forEach((s,i)=>{
    const lx=box.px+i*cw, room=cw-3;
    fillRect(lx,y,7,7,s.col);
    clipTxt(s.lab,lx+10,y+7,room-10,{size:chip,sp:.9,color:C.ink});

    const cur=s.n?s.at(s.n-1):0, num=cur.toFixed(Math.abs(cur)>=100?0:2);
    const vSize=chSz(8,k), vo={size:vSize,color:s.col};
    const withU=s.u? num+" "+s.u : num;
    const str=tw(withU,vo)<=room ? withU : num;
    txt(str,lx,y+21,vo);

    const left=room-tw(str,vo)-4;
    if(s._lo!==undefined){
      const rng=s._lo.toFixed(0)+" .. "+s._hi.toFixed(0), ro={size:chSz(6.5,k),align:"right",color:C.ink2};
      if(tw(rng,ro)<=left) txt(rng,lx+room,y+21,ro);
    }
  });
}
