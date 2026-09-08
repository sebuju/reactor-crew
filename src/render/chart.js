"use strict";

const chSz=(want,k)=>{ const t=want*(k||1);
  for(const s of TSCALE) if(s<=t) return s;
  return TSCALE[TSCALE.length-1]; };
// flat is relative to the magnitude, or an autoscaled channel stretches its own fourth decimal over the plot
function chBand(lo,hi){
  const span=hi-lo, mag=Math.max(Math.abs(lo),Math.abs(hi));
  if(span<=Math.max(1e-6,mag*1e-3)){
    const s=Math.max(mag*.2,1), mid=(lo+hi)/2;
    return [mid-s/2, mid+s/2];
  }
  return [lo-span*.08, hi+span*.08];
}
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

  // range off EVERY sample, not the decimated ones, or a spike escapes the frame
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
      let lo=Infinity,hiV=-Infinity;
      for(const s of auto){ const [a,b]=scale(s); if(a<lo)lo=a; if(b>hiV)hiV=b; }
      const [a,b]=chBand(lo,hiV);
      for(const s of auto){ s._lo=a; s._hi=b; }
    } else {
      for(const s of auto){ const [lo0,hi0]=scale(s), [a,b]=chBand(lo0,hi0);
        s._lo=a; s._hi=b; }
    }
  }

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
    // min+max per column, never every Nth sample: plain decimation aliases
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

// when a column is short the name clips, then the unit goes, then the range; the reading is never trimmed
function chartLegend(box,y,S9,o){
  o=o||{};
  const k=box.k, chip=chSz(6.5,k);
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
