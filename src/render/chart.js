"use strict";

// o = { title, titleCol,
//       series:[{lab,u,col,n,at:i=>v, style:"line"|"dash"}],
//       n,                       // sample count; defaults to the longest series
//       share,                   // one scale across all series
//       marks:[{f,col,lab}],     // f is 0..1 across the plot
//       xlab:[left,right], empty, ph }
function chart(x,y,w,h,o){
  o=o||{};
  const S9=o.series||[], px=x+10, py=y+24, pw=w-20, ph=o.ph!==undefined?o.ph:h-64;
  if(o.title) well(x,y,w,h,o.title,o.titleCol||C.amber,o.titleO);
  fillRect(px,py,pw,ph,C.well); frame(px,py,pw,ph,C.edge);
  for(let g=1;g<4;g++) fillRect(px,py+ph*g/4,pw,1,"rgba(120,180,190,.06)");
  for(let g=1;g<6;g++) fillRect(px+pw*g/6,py,1,ph,"rgba(120,180,190,.05)");

  let n=o.n; if(n===undefined) n=S9.reduce((m,s)=>Math.max(m,s.n||0),0);
  const live = S9.length && n>=2;

  if(!live){
    txt(o.empty||"COLLECTING DATA",px+pw/2,py+ph/2+4,
        {size:10,sp:2,align:"center",color:C.ink2});
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
    if(m.lab) txt(m.lab,X+3,py+9,{size:6.5,sp:.6,color:m.col||C.amber});
  }

  const xl=o.xlab||[];
  if(xl[0]) txt(xl[0],px+3,py+ph-4,{size:7,color:C.ink2});
  if(xl[1]) txt(xl[1],px+pw-3,py+ph-4,{size:7,align:"right",color:C.ink2});
  return {px,py,pw,ph,live};
}

function chartLegend(box,y,S9,o){
  o=o||{};
  const cw=box.pw/4;
  S9.forEach((s,i)=>{
    const lx=box.px+i*cw;
    fillRect(lx,y,7,7,s.col);
    txt(s.lab,lx+12,y+7,{size:7.5,sp:.9,color:C.ink});
    const cur=s.n?s.at(s.n-1):0;
    txt(cur.toFixed(Math.abs(cur)>=100?0:2)+" "+s.u,lx+12,y+21,{size:10,color:s.col});
    if(s._lo!==undefined)
      txt(s._lo.toFixed(0)+" .. "+s._hi.toFixed(0),lx+cw-7,y+21,
          {size:7.5,align:"right",color:C.ink2});
  });
}
