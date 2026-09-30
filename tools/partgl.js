"use strict";
// the PARTICLES pane on the GPU: fields splatted off PART.gl, cut and coloured per pixel, over a back layer the heat bends
const PARTGL = (() => {
const RG = 3, ST = 32, SS = 12, T0 = 273.15;
const V = {W:0, H:0, DV:0, SV:null, wall:null, room:null, MW0:1, S0:1, MC:1, K:null, L:null, DT:null, derive:null, GLOW_FULL:1, GLOW_OFF:1,
  MAXS:0, MAXB:0, sX:null, sY:null, sU:null, sV:null, sL:null, sR:null, bX:null, bY:null, bR:null, bP:null, bT:null,
  px:null, py:null, qx:null, qy:null, vx:null, vy:null, pm:null, pT:null, pfo:null, psx:null, psy:null, pst:null, ph:null, pr:null, pd:null, pf:null, pq:null,
  sg:null, burn:null, kind:null, frz:null, pv:null, pvf:null, Vc:1, crC:null};
let gl = null, cvs = null, wallRef = null, W = 0, H = 0, RW = 0, FW = 0, FH = 0, GPW = 0, GPH = 0, BW = 0, BH = 0, fin = 0, jfin = 0, nS = 0, nD = 0;
let PB = null, SB = null, pbuf = null, sbuf = null, vaoP = null, vaoS = null, vaoE = null;
// FR: the frame's al, cut level th, pixels per cell and a spare, kept off the call boundaries
const T = {}, FB = {}, P = {}, UF = new Float32Array(4), FR = new Float64Array(4), CP = new Float32Array(33);

const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp isampler2D; precision highp usampler2D;
`;
const BRD = `uniform vec2 uBoard;
`;
const CELLS = `uniform usampler2D uWall; uniform isampler2D uRoom; uniform ivec2 uN; uniform int uRW;
bool wallC(ivec2 g){ return g.x >= 0 && g.y >= 0 && g.x < uN.x && g.y < uN.y && texelFetch(uWall, g, 0).r == 1u; }
bool wallP(ivec2 p){ return texelFetch(uWall, p/uRW, 0).r == 1u; }
int roomC(ivec2 g){ return texelFetch(uRoom, g, 0).r; }
`;
const SHIM = `uniform sampler2D uQ; uniform vec4 uHS;
vec2 shim(vec2 b){ float q = textureLod(uQ, b/uBoard, 0.0).r; if(!(q > 0.0)) return vec2(0.0);
  vec2 p = b/uHS.y; float s = uHS.w*uHS.z/uHS.y;
  return uHS.x*q/100.0*vec2(sin(6.2832*(p.y + s) + 2.0*sin(2.3*p.x + 1.3*s)), 0.5*sin(4.4*p.x + 6.2832*(p.y + s) + 1.7)); }
`;
const SCREEN = `uniform vec2 uCan; uniform vec4 uBox;
vec2 boardAt(){ return (vec2(gl_FragCoord.x, uCan.y - gl_FragCoord.y) - uBox.xy)/uBox.zw*uBoard; }
bool onBoard(vec2 b){ return all(greaterThanEqual(b, vec2(0.0))) && all(lessThan(b, uBoard)); }
`;
// field pixels: a narrower splat's cut can miss every pixel centre and its particle paints nothing
const SPLAT_MIN = "1.5";
const VS_FULL = `void main(){ vec2 c = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(c*2.0 - 1.0, 0.0, 1.0); }`;
const VS_SPLAT = `layout(location=0) in vec4 aP; layout(location=1) in vec4 aS; layout(location=2) in vec4 aW;
layout(location=3) in vec4 aD; layout(location=4) in vec4 aG; layout(location=5) in vec4 aH; layout(location=6) in vec4 aX; layout(location=7) in vec4 aM;
uniform int uMode; uniform vec2 uBoard; uniform ivec2 uN; uniform int uRW;
out vec2 vL; flat out vec4 vA; flat out vec2 vB; flat out vec4 vC; flat out vec2 vPos; flat out ivec2 vCell; flat out int vRoom;
void main(){
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1))*2.0 - 1.0;
  float R = uMode == 0 ? aS.x : uMode == 1 ? 1.41421356*aD.x : uMode == 2 ? aG.x : aM.x, st = uMode >= 2 ? 1.0 : aS.y;
  if(uMode != 2 && R > 0.0) R = max(R, ${SPLAT_MIN}/float(uRW));
  vec2 e = uMode >= 2 ? vec2(1.0, 0.0) : aS.zw;
  float cf = floor(aM.w + 0.5), cor = mod(cf, 2.0), fz = floor(cf/2.0);
  vA = uMode == 0 ? aW : uMode == 1 ? aD : uMode == 2 ? aH : aM.y*vec4(1.0, aM.z, cor, fz); vB = uMode == 3 ? vec2(0.0) : aG.yz; vC = uMode == 2 ? aX : vec4(0.0);
  vL = c; vPos = aP.xy; int ci = int(aP.z); vCell = ivec2(ci % uN.x, ci / uN.x); vRoom = int(aP.w);
  if(!(R > 0.0)){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 p = aP.xy + e*(c.x*R*st) + vec2(-e.y, e.x)*(c.y*R/st);
  gl_Position = vec4(p/uBoard*2.0 - 1.0, 0.0, 1.0);
}`;
// a particle colours a pixel only in a cell it may paint today: its room or a doorway, and seen from where it stands
const FS_SPLAT = CELLS + `uniform usampler2D uSV; uniform int uDV, uRes;
in vec2 vL; flat in vec4 vA; flat in vec2 vB; flat in vec4 vC; flat in vec2 vPos; flat in ivec2 vCell; flat in int vRoom;
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1; layout(location=2) out vec4 o2;
bool hitW(vec2 a, vec2 b){
  vec2 d = b - a, f = floor(a); ivec2 s = ivec2(d.x > 0.0 ? 1 : -1, d.y > 0.0 ? 1 : -1), c = ivec2(f);
  int n = abs(int(floor(b.x)) - c.x) + abs(int(floor(b.y)) - c.y);
  float tdx = d.x != 0.0 ? abs(1.0/d.x) : 1e30, tdy = d.y != 0.0 ? abs(1.0/d.y) : 1e30;
  float tx = d.x != 0.0 ? (d.x > 0.0 ? f.x + 1.0 - a.x : a.x - f.x)*tdx : 1e30, ty = d.y != 0.0 ? (d.y > 0.0 ? f.y + 1.0 - a.y : a.y - f.y)*tdy : 1e30;
  for(int k=0;k<256;k++){ if(k >= n) break;
    if(abs(tx - ty) < 1e-6 && (wallC(ivec2(c.x + s.x, c.y)) || wallC(ivec2(c.x, c.y + s.y)))) return true;
    if(tx < ty){ tx += tdx; c.x += s.x; } else { ty += tdy; c.y += s.y; }
    if(wallC(c)) return true; }
  return false;
}
bool sees(ivec2 g){
  int rp = roomC(g);
  if(rp == -1 || (rp != vRoom && rp != -2 && vRoom != -2)) return false;
  ivec2 d = g - vCell; uint s = 2u;
  if(abs(d.x) <= uDV && abs(d.y) <= uDV){ int dw = 2*uDV + 1; s = texelFetch(uSV, ivec2((d.y + uDV)*dw + d.x + uDV, vCell.y*uN.x + vCell.x), 0).r; }
  if(s != 2u) return s == 1u;
  return g == vCell || !hitW(vPos, vec2(g) + 0.5);
}
void main(){ float q = dot(vL, vL); if(q >= 1.0) discard;
  if(!sees(ivec2(gl_FragCoord.xy)/uRes)) discard;
  float k = (1.0 - q)*(1.0 - q); o0 = k*vA; o1 = vec4(k*vB, 0.0, 0.0); o2 = k*vC; }`;
// a lone particle's disk: th at its rim, 2 th at its centre; the depth test keeps the highest disk's speed, T and foam
const FS_DISK = CELLS + `uniform float uTh; in vec2 vL; flat in vec4 vA; out vec4 o0;
void main(){ float q = dot(vL, vL); if(q >= 1.0 || wallP(ivec2(gl_FragCoord.xy))) discard;
  float v = uTh*(2.0 - 2.0*q); o0 = vec4(v, vA.yzw); gl_FragDepth = 1.0 - 0.99*v/(2.0*uTh); }`;
const FS_NORM = `uniform sampler2D uA, uB; uniform float uTh; out vec4 o;
void main(){ ivec2 p = ivec2(gl_FragCoord.xy); vec4 a = texelFetch(uA, p, 0), b = texelFetch(uB, p, 0);
  float f = a.x; bool none = !(f > 0.45*uTh); vec3 s = none ? vec3(0.0, -${T0}, 0.0) : a.yzw/f;
  if(b.x > f){ f = b.x; if(none) s = b.yzw; }
  o = vec4(f, s); }`;
const FS_SMOOTH = CELLS + `uniform sampler2D uIn; uniform ivec2 uDir; out vec4 o;
void main(){ ivec2 p = ivec2(gl_FragCoord.xy), z = textureSize(uIn, 0); vec4 c = texelFetch(uIn, p, 0);
  if(wallP(p)){ o = vec4(0.0, c.yzw); return; }
  float v = 2.0*c.x, w = 2.0; ivec2 q = p - uDir;
  if(q.x >= 0 && q.y >= 0 && !wallP(q)){ v += texelFetch(uIn, q, 0).x; w += 1.0; }
  q = p + uDir; if(q.x < z.x && q.y < z.y && !wallP(q)){ v += texelFetch(uIn, q, 0).x; w += 1.0; }
  o = vec4(v/w, c.yzw); }`;
// water is kept off a wall, so the wall's pixel takes its wettest open neighbour and the edge runs on under the wall paint
const FS_EDGE = CELLS + `uniform sampler2D uIn; out vec4 o;
float nb(ivec2 q, ivec2 z){ return q.x >= 0 && q.y >= 0 && q.x < z.x && q.y < z.y && !wallP(q) ? texelFetch(uIn, q, 0).x : 0.0; }
void main(){ ivec2 p = ivec2(gl_FragCoord.xy), z = textureSize(uIn, 0); vec4 c = texelFetch(uIn, p, 0);
  if(!wallP(p)){ o = c; return; }
  o = vec4(max(max(nb(p - ivec2(1, 0), z), nb(p + ivec2(1, 0), z)), max(nb(p - ivec2(0, 1), z), nb(p + ivec2(0, 1), z))), c.yzw); }`;
const FS_JINIT = CELLS + `uniform sampler2D uIn; uniform float uTh; out vec4 o;
void main(){ ivec2 p = ivec2(gl_FragCoord.xy); o = !wallP(p) && !(texelFetch(uIn, p, 0).x > uTh) ? vec4(vec2(p), 0.0, 0.0) : vec4(-1.0); }`;
// jump flooding to the nearest open gas pixel; a seed in another room is refused, so depth is not measured through a wall
const FS_JSTEP = CELLS + `uniform sampler2D uIn; uniform int uK; out vec4 o;
void main(){ ivec2 p = ivec2(gl_FragCoord.xy), z = textureSize(uIn, 0); int rp = roomC(p/uRW); vec2 best = vec2(-1.0); float bd = 1e20;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ ivec2 q = p + ivec2(i, j)*uK;
    if(q.x < 0 || q.y < 0 || q.x >= z.x || q.y >= z.y) continue;
    vec2 s = texelFetch(uIn, q, 0).xy; if(s.x < 0.0) continue;
    int rs = roomC(ivec2(s)/uRW); if(!(rp == rs || rp == -1 || rp == -2 || rs == -2)) continue;
    vec2 d = s - vec2(p); float e = dot(d, d); if(e < bd){ bd = e; best = s; } }
  o = vec4(best, 0.0, 0.0); }`;
const FS_WCOL = CELLS + `uniform sampler2D uIn, uJ; uniform float uTh; uniform vec4 uK; uniform vec3 cCold, cHot, cDeep, cFoam; out vec4 o;
void main(){ ivec2 p = ivec2(gl_FragCoord.xy); vec4 f = texelFetch(uIn, p, 0); vec2 s = texelFetch(uJ, p, 0).xy;
  float D = wallP(p) || s.x < 0.0 ? 1e9 : length(s - vec2(p));
  float hk = smoothstep(300.0, 380.0, f.z + ${T0}), fo = max(smoothstep(0.2*uK.x, uK.x, f.y)*(1.0 - smoothstep(0.0, uK.y, D)), f.w);
  vec3 c = mix(cCold, cHot, hk);
  if(uK.z > 0.0) c = mix(c, cDeep, 1.0 - exp(-D/uK.z));
  o = vec4(mix(c, cFoam, fo), 1.0); }`;
const FS_QBLUR = `uniform sampler2D uIn; out vec4 o;
void main(){ ivec2 p = ivec2(gl_FragCoord.xy), z = textureSize(uIn, 0) - 1; float s = 0.0, w = 0.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ float k = float((2 - abs(i))*(2 - abs(j))); s += k*texelFetch(uIn, clamp(p + ivec2(i, j), ivec2(0), z), 0).z; w += k; }
  o = vec4(s/w); }`;
// the faintest a gas particle is drawn, too thin to see or not; a floor, not a sum, so a thin cloud does not read thick
const GAS_SEEN = "0.1";
// coloured per screen pixel, not per gas pixel, or a saturated cloud's edge is the gas grid's staircase; cut off water and melt as their own passes cut them
const FS_GAS = BRD + CELLS + SCREEN + `uniform sampler2D uIn, uG1, uG2, uF, uM; uniform float uGop, uTh; uniform vec3 cSteam, cH2, cGlow, cGlowHot, cFlame, cFlameHot, cCO, cCO2, cSmoke; out vec4 o;
vec4 A;
void over(vec3 c, float a){ a = min(0.95, a*uGop); if(!(a > 0.004)) return; A.rgb = A.rgb*(1.0 - a) + c*a; A.a += a*(1.0 - A.a); }
float wet(sampler2D t, vec2 f){ float w = textureLod(t, f/vec2(textureSize(t, 0)), 0.0).x; return smoothstep(-0.5, 0.5, (w - uTh)/max(length(vec2(dFdx(w), dFdy(w))), 1e-6)); }
void main(){ vec2 b = boardAt(), uv = b/uBoard, fw = b*float(uRW); float dry = (1.0 - wet(uF, fw))*(1.0 - wet(uM, fw));
  if(!onBoard(b) || !(dry > 0.0)) discard;
  vec4 g = textureLod(uIn, uv, 0.0); vec2 s = textureLod(uG1, uv, 0.0).xy; vec4 x = textureLod(uG2, uv, 0.0); A = vec4(0.0);
  over(cSteam, min(0.7, 1.5*g.y));
  if(x.x > 0.002) over(cCO, min(0.3, x.x)); if(x.y > 0.002) over(cCO2, min(0.3, x.y)); if(x.z > 0.002) over(cSmoke, min(0.9, x.z));
  if(g.x > 0.002) over(cH2, min(0.55, 1.4*g.x));
  if(s.x > 0.004){ float u = s.y/s.x; over(u < 0.5 ? cGlow*2.0*u : mix(cGlow, cGlowHot, 2.0*u - 1.0), min(0.7, s.x)); }
  if(g.w > 0.02){ over(cFlame, min(0.9, g.w)); over(cFlameHot, min(0.8, max(0.0, g.w - 0.5))); }
  float f = ${GAS_SEEN}*min(1.0, x.w), sw = g.x + g.y + x.x + x.y + x.z;
  if(A.a < f){ float a = (f - A.a)/(1.0 - A.a);
    vec3 c = sw > 0.0 ? (cH2*g.x + cSteam*g.y + cCO*x.x + cCO2*x.y + cSmoke*x.z)/sw : cSteam; A.rgb = A.rgb*(1.0 - a) + c*a; A.a = f; }
  o = A*dry; }`;
const FS_BACK = BRD + SHIM + SCREEN + `uniform sampler2D uBack; uniform vec4 uClip; uniform int uHas; out vec4 o;
void main(){ vec2 sp = vec2(gl_FragCoord.x, uCan.y - gl_FragCoord.y), off = vec2(0.0);
  if(uHas == 1 && all(greaterThanEqual(sp, uClip.xy)) && all(lessThan(sp, uClip.xy + uClip.zw))){ vec2 b = boardAt(); if(onBoard(b)) off = shim(b); }
  o = textureLod(uBack, (sp + off)/uCan, 0.0); }`;
// the cut is a threshold on the bilinear field; its distance in screen pixels comes off the field's own slope
const FS_WATER = BRD + CELLS + SHIM + SCREEN + `uniform sampler2D uF, uWC; uniform float uTh; uniform vec4 uP, cLine; out vec4 o;
bool full(vec2 bl, float k, vec2 z){ vec2 f = clamp((bl + 0.5)*k - 0.5, vec2(0.0), z - 1.001); return textureLod(uF, (f + 0.5)/z, 0.0).x > uTh; }
void main(){ vec2 b = boardAt(), bb = b + shim(b)*uBoard/uBox.zw, z = vec2(textureSize(uF, 0)), f = bb*float(uRW);
  float w = textureLod(uF, f/z, 0.0).x, gx = dFdx(w), gy = dFdy(w);
  if(!onBoard(b) || wallC(ivec2(floor(b)))) discard;
  if(uP.w > 0.0){ float k = float(uRW)/uP.w; vec2 bl = floor(bb*uP.w);
    if(!full(bl, k, z)) discard;
    float top = bl.y < 0.5 || !full(bl - vec2(0.0, 1.0), k, z) ? min(1.0, uP.y) : 0.0;
    o = vec4(mix(texelFetch(uWC, ivec2((bl + 0.5)*k), 0).rgb, cLine.rgb, top)*uP.x, uP.x); return; }
  float d = (w - uTh)/max(length(vec2(gx, gy)), 1e-6), s = 0.5 + 2.0*uP.z, af = smoothstep(-s, s, d);
  vec4 r = vec4(textureLod(uWC, f/z, 0.0).rgb*uP.x*af, uP.x*af);
  if(uP.y > 0.0){ float la = clamp(0.5*uP.y + 0.5 - abs(d), 0.0, 1.0)*cLine.a; r = vec4(cLine.rgb*la, la) + r*(1.0 - la); }
  if(!(r.a > 0.0)) discard;
  o = r; }`;
// metal and corium: their own field, cut as the water is, coloured by temperature: a melt up the glow ramp, a solid dull and cracked. Cold metal is a
// mirror: bright under its surface, dark in depth, banded by what it reflects, with a highlight where the surface faces up
// a pool's quenched crust (uCr, cells, read off the neighbours too: the drawn melt reaches a cell past its particles) is drawn dark on its top, no thinner than this, as a real one of a few cm is under a pixel
const CRUST_MIN = "0.15";
const FS_METAL = BRD + CELLS + SCREEN + `uniform sampler2D uM, uCr; uniform float uTh; uniform vec3 cMetal, cMetalDeep, cSheen, cCrust, cGlow, cMelt, cFire; out vec4 o;
vec3 hot(float T){ vec3 c = mix(cCrust, cGlow, smoothstep(800.0, 1400.0, T)); c = mix(c, cMelt, smoothstep(1400.0, 2200.0, T)); return mix(c, cFire, smoothstep(2200.0, 3000.0, T)); }
vec2 h2(vec2 p){ return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))))*43758.5453); }
float crack(vec2 x){ vec2 n = floor(x), f = fract(x); float d1 = 8.0, d2 = 8.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g = vec2(float(i), float(j)), r = g + h2(n + g) - f; float d = dot(r, r); if(d < d1){ d2 = d1; d1 = d; } else if(d < d2) d2 = d; }
  return sqrt(d2) - sqrt(d1); }
void main(){ vec2 b = boardAt(), z = vec2(textureSize(uM, 0)), f = b*float(uRW);
  vec4 m = textureLod(uM, f/z, 0.0); float w = m.x, gx = dFdx(w), gy = dFdy(w), g = length(vec2(gx, gy));
  if(!onBoard(b) || wallC(ivec2(floor(b))) || !(w > 0.0)) discard;
  float d = (w - uTh)/max(g, 1e-6), a = smoothstep(-0.5, 0.5, d); if(!(a > 0.0)) discard;
  float T = m.y/w + ${T0}, cor = m.z/w, fz = m.w/w;
  vec2 n = g > 1e-6 ? -vec2(gx, gy)/g : vec2(0.0, 1.0);
  float dp = smoothstep(uTh, 5.0*uTh, w), band = 0.5 + 0.5*sin(b.y*5.0 + 2.0*sin(b.x*0.9)), up = max(0.0, dot(n, vec2(-0.3, 0.954)));
  vec3 cold = mix(mix(cSheen, cMetal, smoothstep(0.0, 0.35, dp)), cMetalDeep, smoothstep(0.35, 1.0, dp))*(0.85 + 0.3*band);
  cold = mix(cold, cSheen, (1.0 - smoothstep(0.0, 5.0, d))*up*up*(1.0 - fz));
  vec3 c = mix(mix(cold, hot(T), smoothstep(700.0, 1100.0, T)), hot(T), cor);
  c *= 1.0 - 0.55*fz*(1.0 - smoothstep(0.03, 0.09, crack(b*3.0)));
  ivec2 gc = ivec2(floor(b)); float cr = 0.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ ivec2 q = gc + ivec2(i, j);
    if(q.x < 0 || q.y < 0 || q.x >= uN.x || q.y >= uN.y || wallC(q)) continue; cr = max(cr, texelFetch(uCr, q, 0).r); }
  if(cr > 0.0 && textureLod(uM, (b - vec2(0.0, max(cr, ${CRUST_MIN})))*float(uRW)/z, 0.0).x < uTh) c = cCrust*(0.55 + 0.25*h2(floor(b*12.0)).x);
  o = vec4(c*a, a); }`;
// a bubble is drawn only where the field is water
const VS_SHAPE = CELLS + `layout(location=0) in vec4 aC; layout(location=1) in vec4 aX; layout(location=2) in vec4 aK;
uniform sampler2D uF; uniform vec2 uCan; uniform vec4 uBox; uniform float uTh, uCell;
out vec2 vL; flat out vec4 vR; flat out vec4 vK;
void main(){ vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1))*2.0 - 1.0; vR = vec4(aC.zw, aX.z, 0.0); vK = aK;
  if(aX.w > 0.0){ ivec2 p = ivec2(floor(aC.xy*float(uRW))), z = textureSize(uF, 0);
    if(p.x < 0 || p.y < 0 || p.x >= z.x || p.y >= z.y || wallP(p) || !(texelFetch(uF, p, 0).x > uTh)){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; } }
  vL = c*(aC.zw + 1.0);
  vec2 q = uBox.xy + aC.xy*uCell + aX.xy*vL.x + vec2(-aX.y, aX.x)*vL.y;
  gl_Position = vec4(q.x/uCan.x*2.0 - 1.0, 1.0 - q.y/uCan.y*2.0, 0.0, 1.0); }`;
const FS_SHAPE = `in vec2 vL; flat in vec4 vR; flat in vec4 vK; out vec4 o;
void main(){ float cov = vR.z > 0.5 ? clamp(1.0 - abs(length(vL) - vR.x), 0.0, 1.0) : clamp((1.0 - length(vL/vR.xy))*min(vR.x, vR.y) + 0.5, 0.0, 1.0);
  float a = vK.a*cov; if(!(a > 0.0)) discard; o = vec4(vK.rgb*a, a); }`;

const UNIT = {uWall:0, uRoom:1, uSV:2, uA:3, uB:4, uIn:5, uJ:6, uF:7, uWC:8, uQ:9, uG1:10, uBack:12, uM:13, uG2:14, uCr:15};
const UNI = ["uMode", "uBoard", "uN", "uRW", "uRes", "uDV", "uTh", "uDir", "uK", "uGop", "uHS", "uCan", "uBox", "uClip", "uHas", "uP", "uCell"];
function shader(type, src){ const s = gl.createShader(type); gl.shaderSource(s, HEAD + src); gl.compileShader(s);
  if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
function prog(vs, fs, col){
  const p = gl.createProgram(); gl.attachShader(p, shader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const o = {p}; gl.useProgram(p);
  for(const n of UNI) o[n] = gl.getUniformLocation(p, n);
  for(const n in UNIT){ const l = gl.getUniformLocation(p, n); if(l) gl.uniform1i(l, UNIT[n]); }
  for(const n in col || {}){ const v = hexPack(C[col[n]]), l = gl.getUniformLocation(p, n), s = C[col[n]];
    if(n === "cLine") gl.uniform4f(l, (v >> 16 & 255)/255, (v >> 8 & 255)/255, (v & 255)/255, s.length === 9 ? parseInt(s.slice(7), 16)/255 : 1);
    else gl.uniform3f(l, (v >> 16 & 255)/255, (v >> 8 & 255)/255, (v & 255)/255); }
  return o;
}
function tex(w, h, fmt, lin){ const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
  const f = lin ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; }
function fbo(ts, w, h, depth){ const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  ts.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
  if(depth){ const r = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, r); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, r); f.rb = r; }
  gl.drawBuffers(ts.map((t, i) => gl.COLOR_ATTACHMENT0 + i));
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("framebuffer incomplete");
  return f; }
function drop(keys){ for(const k of keys){ if(T[k]){ gl.deleteTexture(T[k]); T[k] = null; } if(FB[k]){ if(FB[k].rb) gl.deleteRenderbuffer(FB[k].rb); gl.deleteFramebuffer(FB[k]); FB[k] = null; } } }

function init(canvas){
  try{
    cvs = canvas;
    gl = canvas.getContext("webgl2", {alpha:false, antialias:false, depth:false, stencil:false, preserveDrawingBuffer:false});
    if(!gl) throw new Error("no WebGL2 in this browser");
    if(!gl.getExtension("EXT_color_buffer_float")) throw new Error("no EXT_color_buffer_float in this browser");
    P.splat = prog(VS_SPLAT, FS_SPLAT); P.disk = prog(VS_SPLAT, FS_DISK);
    P.norm = prog(VS_FULL, FS_NORM); P.smooth = prog(VS_FULL, FS_SMOOTH); P.edge = prog(VS_FULL, FS_EDGE);
    P.jinit = prog(VS_FULL, FS_JINIT); P.jstep = prog(VS_FULL, FS_JSTEP);
    P.wcol = prog(VS_FULL, FS_WCOL, {cCold:"ptCold", cHot:"ptHot", cDeep:"ptDeep", cFoam:"ptFoam"});
    P.qblur = prog(VS_FULL, FS_QBLUR);
    P.metal = prog(VS_FULL, FS_METAL, {cMetal:"ptMetal", cMetalDeep:"ptMetalDeep", cSheen:"ptSheen", cCrust:"crust", cGlow:"glow", cMelt:"melt", cFire:"fire"});
    P.back = prog(VS_FULL, FS_BACK); P.water = prog(VS_FULL, FS_WATER, {cLine:"ptLine"}); P.gas = prog(VS_FULL, FS_GAS, {cSteam:"ptSteam", cH2:"ptH2", cGlow:"red", cGlowHot:"ptGlowHot", cFlame:"ptFlame", cFlameHot:"fire2", cCO:"ptCO", cCO2:"ptCO2", cSmoke:"ptSmoke"});
    P.shape = prog(VS_SHAPE, FS_SHAPE);
    ["ptSpray", "blue", "ptSteam", "h2", "amber", "ptMetal", "glow", "ptCO", "ptCO2", "ptSmoke", "fire2"].forEach((k, i) => { const v = hexPack(C[k]); CP[3*i] = (v >> 16 & 255)/255; CP[3*i+1] = (v >> 8 & 255)/255; CP[3*i+2] = (v & 255)/255; });
    vaoE = gl.createVertexArray();
    T.q0 = tex(1, 1, gl.R16F, true);
    return "";
  }catch(e){ gl = null; return "particles: " + (e && e.message || e); }
}

function buffers(){
  const n = V.px.length;
  PB = new Float32Array(n*ST); SB = new Float32Array((V.MAXB + V.MAXS + n)*SS);
  pbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pbuf); gl.bufferData(gl.ARRAY_BUFFER, PB.byteLength, gl.DYNAMIC_DRAW);
  vaoP = gl.createVertexArray(); gl.bindVertexArray(vaoP);
  for(let k=0;k<8;k++){ gl.enableVertexAttribArray(k); gl.vertexAttribPointer(k, 4, gl.FLOAT, false, ST*4, k*16); gl.vertexAttribDivisor(k, 1); }
  sbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, sbuf); gl.bufferData(gl.ARRAY_BUFFER, SB.byteLength, gl.DYNAMIC_DRAW);
  vaoS = gl.createVertexArray(); gl.bindVertexArray(vaoS);
  for(let k=0;k<3;k++){ gl.enableVertexAttribArray(k); gl.vertexAttribDivisor(k, 1); }
  gl.bindVertexArray(null);
}
function shapeBase(first){ gl.bindVertexArray(vaoS); gl.bindBuffer(gl.ARRAY_BUFFER, sbuf);
  for(let k=0;k<3;k++) gl.vertexAttribPointer(k, 4, gl.FLOAT, false, SS*4, (first*SS + 4*k)*4); }
function board(){
  W = V.W; H = V.H; wallRef = V.wall;
  drop(["wall", "room", "sv", "cr"]);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const dw = 2*V.DV + 1;
  T.wall = tex(W, H, gl.R8UI, false); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RED_INTEGER, gl.UNSIGNED_BYTE, V.wall);
  T.room = tex(W, H, gl.R32I, false); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RED_INTEGER, gl.INT, V.room);
  T.sv = tex(dw*dw, W*H, gl.R8UI, false); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, dw*dw, W*H, gl.RED_INTEGER, gl.UNSIGNED_BYTE, V.SV);
  T.cr = tex(W, H, gl.R32F, false);
  RW = 0;
}
function fields(){
  RW = V.K.wpx; FW = W*RW; FH = H*RW; GPW = W*RG; GPH = H*RG;
  drop(["A", "B", "F0", "F1", "J0", "J1", "WC", "G0", "G1", "G2", "QB", "M"]);
  const hf = k => { T[k] = tex(FW, FH, gl.RGBA16F, true); FB[k] = fbo([T[k]], FW, FH, false); };
  hf("A"); hf("F0"); hf("F1"); hf("M");
  T.B = tex(FW, FH, gl.RGBA16F, false); FB.B = fbo([T.B], FW, FH, true);
  for(const k of ["J0", "J1"]){ T[k] = tex(FW, FH, gl.RG16F, false); FB[k] = fbo([T[k]], FW, FH, false); }
  T.WC = tex(FW, FH, gl.RGBA8, true); FB.WC = fbo([T.WC], FW, FH, false);
  T.G0 = tex(GPW, GPH, gl.RGBA16F, true); T.G1 = tex(GPW, GPH, gl.RGBA16F, true); T.G2 = tex(GPW, GPH, gl.RGBA16F, true); FB.G0 = fbo([T.G0, T.G1, T.G2], GPW, GPH, false);
  T.QB = tex(GPW, GPH, gl.R16F, true); FB.QB = fbo([T.QB], GPW, GPH, false);
}

function pack(){
  const al = FR[0], n = V.L.np, B = PB, K = V.K, px = V.px, py = V.py, qx = V.qx, qy = V.qy, vx = V.vx, vy = V.vy, pm = V.pm, pT = V.pT, pfo = V.pfo;
  const psx = V.psx, psy = V.psy, pst = V.pst, ph = V.ph, pr = V.pr, pd = V.pd, pf = V.pf, pq = V.pq, sg = V.sg, burn = V.burn, kind = V.kind, room = V.room, pvf = V.pvf, frz = V.frz, pv = V.pv, vc = V.Vc;
  const w = W, h = H, blob = K.blob, gb = K.gblur, t = V.L.t, mw = V.MW0, s2 = V.S0*V.S0, mc = V.MC, full = V.GLOW_FULL, off = V.GLOW_OFF;
  for(let p=0;p<n;p++){ const o = p*ST, k = kind[p];
    const x = al === 1 ? px[p] : qx[p] + (px[p] - qx[p])*al, y = al === 1 ? py[p] : qy[p] + (py[p] - qy[p])*al;
    const c = Math.min(h - 1, Math.max(0, y|0))*w + Math.min(w - 1, Math.max(0, x|0)), s = Math.sqrt(vx[p]*vx[p] + vy[p]*vy[p])*MPC;
    B[o] = x; B[o+1] = y; B[o+2] = c; B[o+3] = room[c];
    const ga = sg[p] ? Math.min(1, Math.max(0, (s - off)/off)) : 0; B[o+17] = ga; B[o+18] = ga*Math.min(1, s/full);
    if(k === 1){ const sp = 0.5*ph[p], m = pm[p]/mw*s2/(sp*sp), a = psx[p], b = psy[p], sv = Math.sqrt(a*a + b*b), T1 = pT[p] - T0, f = pfo[p];
      B[o+4] = blob*sp; B[o+5] = pst[p]; B[o+6] = sv > 0 ? a/sv : 1; B[o+7] = sv > 0 ? b/sv : 0;
      B[o+8] = m; B[o+9] = m*s; B[o+10] = m*T1; B[o+11] = m*f;
      B[o+12] = Math.sqrt(pm[p]/mc/Math.PI); B[o+13] = s; B[o+14] = T1; B[o+15] = f;
      B[o+16] = sg[p] ? blob*sp : 0; B[o+20] = 0; B[o+21] = 0; B[o+22] = 0; B[o+23] = 0; for(let j=24;j<32;j++) B[o+j] = 0; }
    else if(k === 5 || k === 6){ const sp = 0.5*ph[p];
      for(let j=4;j<24;j++) B[o+j] = 0; B[o+24] = 0; B[o+25] = 0; B[o+26] = 0; B[o+27] = 0;
      B[o+28] = blob*sp; B[o+29] = pm[p]*pvf[p]/mw*s2/(sp*sp); B[o+30] = pT[p] - T0; B[o+31] = (k === 6 ? 1 : 0) + 2*frz[p]; }
    else { B[o+4] = 0; B[o+12] = 0; B[o+16] = pr[p] + gb;
      B[o+20] = k === 3 ? pf[p] : 0; B[o+21] = k === 2 ? pf[p] : 0; B[o+22] = k === 2 || k === 3 || k >= 7 ? 0 : pd[p];
      B[o+23] = (k === 3 || k === 7) && burn[p] ? pq[p]*(0.8 + 0.4*Math.sin(p*7.1 + t*40)) : 0;
      B[o+24] = k === 7 ? pf[p] : 0; B[o+25] = k === 8 ? pf[p] : 0; B[o+26] = k === 9 ? pm[p]/(pv[p]*vc)/SMOKE_SEE : 0; B[o+27] = k === 2 || k === 3 || k >= 7 ? 1 : 0;
      B[o+28] = 0; B[o+29] = 0; B[o+30] = 0; B[o+31] = 0; } }
  return n;
}
// kg/m3 of sodium smoke that reads as a full white: a room thick enough not to see across (set by eye)
const SMOKE_SEE = 0.02;
// bubbles and spray first, dots after the gas; sizes in screen pixels off cpx, the pixels a cell spans
function shapes(dots, np){
  const al = FR[0], cpx = FR[2], S = SB, K = V.K, wop = K.wop, bX = V.bX, bY = V.bY, bR = V.bR, bP = V.bP, bT = V.bT;
  let n = 0;
  const rb0 = Math.max(0.07*cpx, 1.5);
  for(let i=0;i<V.MAXB;i++){ if(!(bT[i] > 0)) continue; const o = n*SS, r = rb0*bR[i];
    S[o] = bX[i] + 0.08*Math.sin(bP[i]); S[o+1] = bY[i]; S[o+2] = r; S[o+3] = r; S[o+4] = 1; S[o+5] = 0; S[o+6] = 1; S[o+7] = 1;
    S[o+8] = CP[0]; S[o+9] = CP[1]; S[o+10] = CP[2]; S[o+11] = 0.7*wop; n++; }
  if(K.spray > 0){ const sX = V.sX, sY = V.sY, sU = V.sU, sV = V.sV, sL = V.sL, sR = V.sR, back = V.DT[0]*(al - 1), r0 = Math.max(K.sdrop*cpx, 2);
    for(let i=0;i<V.MAXS;i++){ if(!(sL[i] > 0)) continue; const o = n*SS, u = sU[i], v = sV[i], sv = Math.sqrt(u*u + v*v), st = Math.min(3, 1 + K.dstr*sv*MPC), r = r0*sR[i];
      S[o] = sX[i] + u*back; S[o+1] = sY[i] + v*back; S[o+2] = r*st; S[o+3] = r/st; S[o+4] = sv > 0 ? u/sv : 1; S[o+5] = sv > 0 ? v/sv : 0; S[o+6] = 0; S[o+7] = 0;
      S[o+8] = CP[0]; S[o+9] = CP[1]; S[o+10] = CP[2]; S[o+11] = 0.9*wop*Math.min(1, sL[i]/0.4); n++; } }
  nS = n;
  if(dots){ const kind = V.kind, burn = V.burn;
    for(let p=0;p<np;p++){ const o = n*SS, k = kind[p], r = cpx*(k === 1 || k === 5 || k === 6 ? 0.09 : 0.06), c = burn[p] ? 30 : 3*k;
      S[o] = PB[p*ST]; S[o+1] = PB[p*ST+1]; S[o+2] = r; S[o+3] = r; S[o+4] = 1; S[o+5] = 0; S[o+6] = 0; S[o+7] = 0;
      S[o+8] = CP[c]; S[o+9] = CP[c+1]; S[o+10] = CP[c+2]; S[o+11] = 0.9; n++; } }
  nD = n - nS;
  return n;
}

const tbind = (u, t) => { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, t); };
function target(f, w, h){ gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.viewport(0, 0, w, h); }
function cells(p){ gl.uniform2i(p.uN, W, H); gl.uniform1i(p.uRW, RW); UF[0] = W; UF[1] = H; if(p.uBoard) gl.uniform2fv(p.uBoard, UF, 0, 2); }
function f1(l, k){ UF[0] = FR[k]; gl.uniform1fv(l, UF, 0, 1); }
function full(p, f, w, h){ target(f, w, h); gl.useProgram(p.p); gl.drawArrays(gl.TRIANGLES, 0, 3); }

function splats(np){
  const K = V.K;
  gl.bindVertexArray(vaoP);
  tbind(0, T.wall); tbind(1, T.room); tbind(2, T.sv);
  gl.clearColor(0, 0, 0, 0); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  const s = P.splat; gl.useProgram(s.p); cells(s); gl.uniform1i(s.uDV, V.DV);
  target(FB.A, FW, FH); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform1i(s.uMode, 0); gl.uniform1i(s.uRes, RW); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, np);
  target(FB.G0, GPW, GPH); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform1i(s.uMode, 2); gl.uniform1i(s.uRes, RG); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, np);
  target(FB.M, FW, FH); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform1i(s.uMode, 3); gl.uniform1i(s.uRes, RW); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, np);
  gl.disable(gl.BLEND);
  const d = P.disk; gl.useProgram(d.p); cells(d); gl.uniform1i(d.uMode, 1); f1(d.uTh, 1);
  target(FB.B, FW, FH); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, np); gl.disable(gl.DEPTH_TEST);
  gl.bindVertexArray(vaoE);
  tbind(3, T.A); tbind(4, T.B); gl.useProgram(P.norm.p); f1(P.norm.uTh, 1); full(P.norm, FB.F0, FW, FH);
  let a = "F0", b = "F1";
  gl.useProgram(P.smooth.p); cells(P.smooth);
  for(let k=0;k<K.wsmooth;k++) for(let d2=0;d2<2;d2++){ gl.uniform2i(P.smooth.uDir, 1 - d2, d2); tbind(5, T[a]); full(P.smooth, FB[b], FW, FH); const t = a; a = b; b = t; }
  gl.useProgram(P.edge.p); cells(P.edge); tbind(5, T[a]); full(P.edge, FB[b], FW, FH); fin = b;
  gl.useProgram(P.jinit.p); cells(P.jinit); f1(P.jinit.uTh, 1); tbind(5, T[fin]); full(P.jinit, FB.J0, FW, FH);
  let j = "J0", jb = "J1";
  gl.useProgram(P.jstep.p); cells(P.jstep);
  for(let k=1<<Math.ceil(Math.log2(Math.max(FW, FH)) - 1);k>=1;k>>=1){ gl.uniform1i(P.jstep.uK, k); tbind(5, T[j]); full(P.jstep, FB[jb], FW, FH); const t = j; j = jb; jb = t; }
  gl.uniform1i(P.jstep.uK, 1); tbind(5, T[j]); full(P.jstep, FB[jb], FW, FH); jfin = jb;
  const c = P.wcol; gl.useProgram(c.p); cells(c); f1(c.uTh, 1);
  UF[0] = K.foam; UF[1] = K.fdepth*RW; UF[2] = K.wdark*RW; UF[3] = 0; gl.uniform4fv(c.uK, UF, 0, 4);
  tbind(5, T[fin]); tbind(6, T[jfin]); full(c, FB.WC, FW, FH);
  tbind(5, T.G0); full(P.qblur, FB.QB, GPW, GPH);
}
function screen(p, box, cw, ch){ UF[0] = cw; UF[1] = ch; gl.uniform2fv(p.uCan, UF, 0, 2);
  if(box){ UF[0] = box[0]; UF[1] = box[1]; UF[2] = box[2]; UF[3] = box[3]; gl.uniform4fv(p.uBox, UF, 0, 4); } }
function shim(p){ const K = V.K; UF[0] = K.hs; UF[1] = K.hsc; UF[2] = K.hsv; UF[3] = V.L.t; gl.uniform4fv(p.uHS, UF, 0, 4); }

// back: the BACK canvas; box: the board and the pane it sits in, canvas pixels [x, y, w, h, clip x, clip y, clip w, clip h], or null
function frame(back, box, dots, al){
  if(!gl) return;
  const cw = back.width, ch = back.height;
  if(cvs.width !== cw || cvs.height !== ch){ cvs.width = cw; cvs.height = ch; }
  if(cw !== BW || ch !== BH){ drop(["back"]); T.back = tex(cw, ch, gl.RGBA8, true); BW = cw; BH = ch; }
  tbind(12, T.back); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, back);
  const live = box !== null && PART.L.ready;
  if(live){
    PART.gl(V);
    if(!PB) buffers();
    if(V.wall !== wallRef) board();
    if(RW !== V.K.wpx) fields();
    V.derive();
    const K = V.K, rwk = K.blob/Math.sqrt(K.ppc);
    FR[0] = al < 1 ? al : 1; FR[1] = K.merge*K.ppc*Math.PI*rwk*rwk/3; FR[2] = box[2]/W;
    const np = pack();
    gl.bindBuffer(gl.ARRAY_BUFFER, pbuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, PB, 0, np*ST);
    const ns = shapes(dots, np);
    gl.bindBuffer(gl.ARRAY_BUFFER, sbuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, SB, 0, ns*SS);
    splats(np);
  }
  gl.bindVertexArray(vaoE);
  target(null, cw, ch);
  const b = P.back; gl.useProgram(b.p); screen(b, box, cw, ch); gl.uniform1i(b.uHas, live ? 1 : 0);
  tbind(12, T.back); tbind(9, live ? T.QB : T.q0);
  if(live){ cells(b); shim(b); UF[0] = box[4]; UF[1] = box[5]; UF[2] = box[6]; UF[3] = box[7]; gl.uniform4fv(b.uClip, UF, 0, 4); }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  if(!live) return;
  const K = V.K;
  gl.enable(gl.SCISSOR_TEST); gl.scissor(Math.round(box[4]), Math.round(ch - box[5] - box[7]), Math.round(box[6]), Math.round(box[7]));
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  tbind(0, T.wall); tbind(1, T.room); tbind(7, T[fin]); tbind(8, T.WC);
  const w = P.water; gl.useProgram(w.p); cells(w); screen(w, box, cw, ch); shim(w); f1(w.uTh, 1);
  UF[0] = K.wop; UF[1] = K.wline; UF[2] = K.wsoft; UF[3] = K.wpix; gl.uniform4fv(w.uP, UF, 0, 4);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  tbind(15, T.cr); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RED, gl.FLOAT, V.crC);
  tbind(13, T.M); const mt = P.metal; gl.useProgram(mt.p); cells(mt); screen(mt, box, cw, ch); f1(mt.uTh, 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
  const s = P.shape; gl.useProgram(s.p); cells(s); screen(s, box, cw, ch); f1(s.uTh, 1); f1(s.uCell, 2);
  if(nS > 0){ shapeBase(0); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nS); }
  gl.bindVertexArray(vaoE);
  tbind(5, T.G0); tbind(10, T.G1); tbind(14, T.G2); FR[3] = K.gop;
  const g = P.gas; gl.useProgram(g.p); cells(g); screen(g, box, cw, ch); f1(g.uGop, 3); f1(g.uTh, 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
  if(nD > 0){ gl.useProgram(s.p); shapeBase(nS); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nD); }
  gl.bindVertexArray(null);
  gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST);
}

return {init, frame};
})();
