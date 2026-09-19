"use strict";
/* Prompt fission energy fraction; E_DEC_A sums to the 6.5 % remainder. The partition below puts the decay
   group at 6.36 % of the recoverable total; ANS-5.1-1979's own fit reads 6.59 % on 200 MeV. 0.935 sits
   between them. */
const PROMPT_F=0.935;
/* recoverable MeV per U-235 fission, ENDF/B-VIII.0 n-092_U_235.endf MF=1 MT=458 at thermal: fragments
   169.130, prompt neutrons 4.8276, delayed neutrons 0.008074, prompt gamma 7.2813, delayed fission-product
   gamma 6.330 +- 0.050, delayed beta 6.500 +- 0.050. Capture gamma is not a property of the fission and is
   absent from MT=458: 3-12 MeV (Lamarsh 1975 via INL/EXT-13-29256 Table 1), 7.5 taken. */
const FIS_QCAP=7.5, FIS_QD=6.500+6.330, FIS_QP=169.130+4.8276+0.008074+7.2813+FIS_QCAP;
const FIS_FN=(4.8276+0.008074)/FIS_QP, FIS_FGP=(7.2813+FIS_QCAP)/FIS_QP, FIS_FGD=6.330/FIS_QD;
/* mu/rho and mu_en/rho cm2/g at 1 MeV (Hubbell & Seltzer, NISTIR 5632) and g/mol; a mixture is its mass-weighted sum, an *Of takes atom counts and a *WOf weight fractions */
const MU1={H:.1263,He:.06362,Li:.05503,Be:.05652,B:.05890,C:.06361,O:.06372,F:.06037,Na:.06100,Mg:.06296,Zr:.05810,Ag:.05921,Cd:.05826,In:.05849,Hf:.06502,U:.07896};
const MUEN1={H:.05556,He:.02797,Li:.02419,Be:.02483,B:.02586,C:.02792,O:.02794,F:.02645,Na:.02669,Mg:.02753,Zr:.02547,Ag:.02632,Cd:.02597,In:.02615,Hf:.03188,U:.04241};
const AWT={H:1.008,He:4.0026,Li:6.94,Be:9.0122,B:10.81,C:12.011,O:15.999,F:18.998,Na:22.990,Mg:24.305,Zr:91.224,Ag:107.87,Cd:112.41,In:114.82,Hf:178.49,U:238.03};
const mixW=(t,w)=>{ let s=0; for(const e in w) s+=w[e]*t[e]; return s; };
const atomW=f=>{ let m=0; const w={}; for(const e in f) m+=f[e]*AWT[e]; for(const e in f) w[e]=f[e]*AWT[e]/m; return w; };
const muenOf=f=>mixW(MUEN1,atomW(f)), muOf=f=>mixW(MU1,atomW(f));
const muenWOf=w=>mixW(MUEN1,w), muWOf=w=>mixW(MU1,w);
/* Gamma transport in one lattice cell, every photon born in the fuel. A photon in region r collides there
   with Wigner's Sl/(1+Sl) and otherwise anywhere in the cell by weight S*V*(1-e^-Sl)/Sl, an infinite
   lattice opening onto an identical cell; a collision leaves mu_en/mu of the energy behind and sends the
   rest off again. Every Sl -> 0 is deposition by mass x mu_en/rho exactly. sig 1/cm, chord cm, vol one unit. */
const HEAT_CP_PASS=64, HEAT_CP_TOL=1e-12;
function heatCP(sig,vol,chord,f,src,dep){
  const n=sig.length, prr=new Float64Array(n), w=new Float64Array(n), cur=new Float64Array(n), hit=new Float64Array(n);
  let wt=0;
  for(let r=0;r<n;r++){ const sl=sig[r]*chord[r];
    prr[r]= sl>0 ? sl/(1+sl) : 0;
    w[r]= sl>1e-9 ? sig[r]*vol[r]*(1-Math.exp(-sl))/sl : sig[r]*vol[r];
    wt+=w[r]; cur[r]=src[r]; dep[r]=0; }
  for(let p=0;p<HEAT_CP_PASS;p++){
    let esc=0, left=0;
    for(let r=0;r<n;r++){ hit[r]=cur[r]*prr[r]; esc+=cur[r]-hit[r]; }
    for(let r=0;r<n;r++){ const c=hit[r]+(wt>0?esc*w[r]/wt:0), d=c*f[r];
      dep[r]+=d; cur[r]=c-d; left+=cur[r]; }
    if(left<=HEAT_CP_TOL) break; }
  return dep; }
/* The fission partition meeting the deposition: gW/gB/gS/gA are shares of the cell's gamma energy stopped in
   the water, the blocks, the structures and the absorber, cc and mb the moderation weights of water and
   blocks, a the void. Writes each of the four its share of prompt heat then of decay heat, into o at b. */
function heatSplitA(gW,gB,gS,gA,cc,mb,a,o,b){
  const cw=cc*(1-a), n=cw+mb, nw=n>0?cw/n:0, nb=n>0?mb/n:0;
  o[b  ]=FIS_FN*nw+FIS_FGP*gW; o[b+1]=FIS_FGD*gW;
  o[b+2]=FIS_FN*nb+FIS_FGP*gB; o[b+3]=FIS_FGD*gB;
  o[b+4]=FIS_FGP*gS;           o[b+5]=FIS_FGD*gS;
  o[b+6]=FIS_FGP*gA;           o[b+7]=FIS_FGD*gA; }

/* boron:false a coolant that carries no dissolved boron, so its core is held by the bank; qpp MW/m2; modK/absK per unit volume against light water; dens at own Tref on RHO_K's scale, tsat, hfg and cp: stated by any fluid but water, whose figures are IAPWS-IF97 at its own P0 and Tref (coolFig()); tc/pc/rhoc K/MPa/kg/m3; Tref the PROGRAMMED coolant temperature; pipeK spent per metre drawn; dnbLaw picks the limit (dnbrOf(), step.js); xOut, a boiling row's core exit quality, stands in for dT0 (coolFig()). */
const COOLANT=[
 {id:"PWR", name:"PRESSURISED WATER", tie:"WESTINGHOUSE / VVER", mass:340,muen:muenOf({H:2,O:1}),muAt:muOf({H:2,O:1}),
  P0:15.5,pipeK:1.00,col:"#5aa9d6",dT0:30,dpCore:0.30,mu:8.6e-5,muV:2.0e-5,vLeg:15,hFilm:30000,mmol:.018,tc:647.096,pc:22.06,rhoc:322,Tref:583,aF:-2.8,modK:1.00,absK:1.00,qpp:1.80,grace:1.0,dnbr:1.85,dnbLaw:"w3",oxid:true,xe:1.0,flowMin:.30,eff:.504,solidK:1.4,
  good:"Dense, well understood, strongly self-limiting",
  bad:"15.5 MPa vessel is heavy; a breach depressurises violently"},
 {id:"BWR", name:"BOILING WATER", tie:"GE MARK I", mass:265,muen:muenOf({H:2,O:1}),muAt:muOf({H:2,O:1}),
  P0:7.0,pipeK:1.00,col:"#5aa9d6",xOut:0.146,dpCore:0.15,mu:8.6e-5,muV:2.0e-5,vLeg:15,hFilm:30000,mmol:.018,tc:647.096,pc:22.06,rhoc:322,Tref:559,aF:-2.8,modK:1.00,absK:1.00,qpp:1.71,grace:0.9,dnbr:1.55,dnbLaw:"w3",oxid:true,xe:1.0,flowMin:.30,eff:.496,solidK:1.5,
  good:"Direct cycle, lighter, power follows flow instantly",
  bad:"Turbine hall is radioactive; margin to dryout is thin"},
 {id:"LWGR",name:"PRESSURE TUBE WATER", tie:"RBMK-1000", mass:250,muen:muenOf({H:2,O:1}),muAt:muOf({H:2,O:1}),
  P0:6.9,pipeK:1.00,col:"#5aa9d6",xOut:0.145,dpCore:1.00,mu:8.6e-5,muV:2.0e-5,vLeg:15,hFilm:30000,mmol:.018,tc:647.096,pc:22.06,rhoc:322,Tref:550,aF:-1.2,modK:1.00,absK:1.00,qpp:0.99,grace:1.2,dnbr:1.60,dnbLaw:"w3",oxid:true,xe:1.0,flowMin:.30,eff:.466,solidK:1.5,dTg:444,
  good:"Cheap fuel, refuels online, boils in the channel itself",
  bad:"Lay graphite around it and the water is a poison, not a moderator"},
 {id:"SFR", name:"LIQUID SODIUM", tie:"EBR-II / BN-800", mass:210,muen:muenOf({Na:1}),muAt:muOf({Na:1}),
  P0:0.2,pipeK:2.00,col:"#c8b8a0",tsat:1150,hfg:4260,cp:1.25,dT0:170,dpCore:0.50,mu:2.5e-4,muV:2.0e-5,vLeg:8,hFilm:60000,mmol:.02299,tc:2573,pc:25.6,rhoc:219,Tref:723,aF:-1.2,modK:.05,absK:.15,dens:121,qpp:5.04,grace:6.0,dnbr:3.20,dnbLaw:"boil",burn:"NA",bulk:5.8e9,xe:0.85,flowMin:.20,eff:.633,solidK:1.4,
  good:"Atmospheric pressure, very light, huge boiling margin",
  bad:"Barely slows a neutron, so a core cooled by it is a FAST core"},
 {id:"MSR", name:"MOLTEN SALT", tie:"MSRE", mass:230,muen:muenOf({Li:2,Be:1,F:4}),muAt:muOf({Li:2,Be:1,F:4}),
  P0:0.2,pipeK:2.40,col:"#8fd18a",fuelInCoolant:true,tsat:1700,hfg:4500,cp:2.39,dT0:140,dpCore:0.04,mu:6.0e-3,muV:3.0e-5,vLeg:5,hFilm:6000,mmol:.0433,tc:4500,pc:160,rhoc:460,Tref:922,aF:-3.5,modK:.35,absK:.18,dens:280,qpp:1.44,grace:9.0,dnbr:3.00,dnbLaw:"boil",xe:0.15,flowMin:.20,eff:.697,solidK:0.5,
  good:"No pressure; gases stripped online, almost no xenon pit",
  bad:"Corrodes continuously; freezes solid if it gets cold"},
 {id:"HTGR",name:"HELIUM GAS", tie:"HTR-PM", mass:260,muen:muenOf({He:1}),muAt:muOf({He:1}),
  P0:7.0,pipeK:2.60,col:"#c8a8d8",tsat:2000,hfg:20.9,cp:5.19,dT0:250,dpCore:0.06,mu:4.5e-5,muV:4.5e-5,vLeg:60,hFilm:1500,mmol:.004,satN:.10,tc:5.195,pc:.227,rhoc:69.6,Tref:773,aF:-4.5,modK:0,absK:0,dens:0.62,qpp:0.108,grace:40,dnbr:2.60,dnbLaw:"temp",xe:1.0,flowMin:.15,eff:.623,solidK:0.009,
  good:"Cannot melt. Grace time in hours, not seconds. Voids into nothing",
  bad:"Moderates nothing at all - draw the moderator or draw a fast core"},
 /* Calder Hall as designed (Nuclear Engineering, Dec. 1956, "The World's Reactors No. 6", off the BNEC Calder Works symposium): 100 psig, 140 C in, 336 C out, 1964 lb/s, circuit drop 5.53 psi, can surface design maximum 408 C; NIST WebBook: Shomate 298-1200-6000 K, M, Tc/Pc/rhoc (Suehiro 1996), hfg at 258 K (never reached), mu at 500 K / 0.7 MPa; dens and gam ideal gas at P0/Tref; hFilm Dittus-Boelter on the zone B channel annulus (3.95 in bore, 54 mm element) at 891/1696 kg/s; qpp that film from the mean gas, where the peak node sits at mid-height, to the 408 C can; aF -1.7e-5/C (JAERI-1006-A); dpCore the whole circuit's drop; modK/absK 0 at 1/100 of water's density; eff FIT so the design efficiency is the sheet's 42 MWe of 182 MWt; grace, dnbr, xe, flowMin, pipeK, vLeg, mass are game figures */
 {id:"CO2", name:"CARBON DIOXIDE GAS", tie:"CALDER HALL", mass:260,muen:muenOf({C:1,O:2}),muAt:muOf({C:1,O:2}),
  P0:0.7908,pipeK:2.60,col:"#b8c890",tsat:5000,hfg:372.6,cp:1.0212,dT0:196,dpCore:0.0381,mu:2.40e-5,muV:2.40e-5,vLeg:60,hFilm:234,mmol:.0440095,satN:.10,tc:304.18,pc:7.380,rhoc:466.5,Tref:511.15,aF:-1.7,modK:0,absK:0,dens:1.1699,gam:1.227,qpp:0.03978,grace:40,dnbr:2.60,dnbLaw:"temp",xe:1.0,flowMin:.15,eff:.324,solidK:0.001547,boron:false,
  sho:[1200,24.99735,55.18696,-33.69137,7.948387,-0.136638,-403.6075,228.2431,-393.5224, 6000,58.16639,2.720074,-0.492289,0.038844,-6.447293,-425.9186,263.6125,-393.5224],
  good:"Cheap, inert with graphite, and it cannot boil",
  bad:"A thin gas at low pressure: it needs a huge core, finned cans and big blowers to carry the heat away"},
];
/* Clausius-Clapeyron about the fluid's own boiling point, anchored on SAT_WATER; satN overrides it (helium is supercritical throughout). */
const R_GAS=8.314, SATN_MMOL=.018;
const ccSlope = (f, mmol) => R_GAS*f.tsat/(f.hfg*1000*mmol);
const coolSatN = a => a.satN!=null
  ? a.satN : SAT_WATER.n*ccSlope(coolFig(a), a.mmol)/ccSlope({tsat:SAT_WATER.T0, hfg:SAT_WATER.hfg}, SATN_MMOL);
/* modK against light water, dens for latMass(), aT pcm/K at full share of a thermal spectrum, muen for heatShares(), cpA kJ/kg/K. Blocks with a cpA have a temperature of their own where the coolant row states dTg, the hottest block over its water at rating (modOwnT()). */
const MODER=[
 {name:"GRAPHITE",modK:.95,dens:1.70,aT:3,muen:muenOf({C:1}),muAt:muOf({C:1}),cpA:graphCpA,
  note:"The classic solid moderator. Slows neutrons well over many collisions, so a graphite core is large and dilute - and the water in it becomes a net absorber, which is what makes a channel-water graphite plant void POSITIVE."},
 {name:"BERYLLIUM OXIDE",modK:1.35,dens:3.00,aT:0,muen:muenOf({Be:1,O:1}),muAt:muOf({Be:1,O:1}),
  note:"Better than graphite per litre and it multiplies neutrons on top, so a smaller core reaches the same spectrum. Heavy for what it is, and it pushes the void coefficient positive the same way the reflector does."},
 {name:"ZIRCONIUM HYDRIDE",modK:1.80,dens:5.60,aT:-12,muen:muenOf({Zr:1,H:1.6}),muAt:muOf({Zr:1,H:1.6}),
  note:"Hydrogen locked into a solid: the densest moderation you can lay, so a very compact thermal core is possible. It is also the heaviest, and hydrogen leaves it if it gets hot enough."},
];
/* the pressure-tube row's dTg is the RBMK-1000's 730 C allowed block over 286 C channel water */
const modOwnT = c => !!MODER[c.mod].cpA && COOLANT[c.cool].dTg > 0 && modShares(c).block > 0;
/* kJ/kg/K of nuclear graphite, Butland & Maddison (J. Nucl. Mater. 49, 1973), their fit in cal/g/K */
function graphCpA(io, k, o){ const T = io[k], i = 1/T;
  io[o] = 4.184*(0.54212 - 2.42667e-6*T - i*(90.2725 + i*(43449.3 - i*(1.59309e7 - i*1.43688e9)))); }
const GCP_IO = new Float64Array(2);
const graphCp = T => { GCP_IO[0] = T; graphCpA(GCP_IO, 0, 1); return GCP_IO[1]; };
/* tdmg K where damage starts and the RPS trips 100 K above it; tmelt the fuel's melting point (solidus); alpha linear expansion 1/K; rho kg/m3, k W/m/K the pellet rise reads, kint kW/m the conductivity integral to melt the rating reads, M kg/mol, hfus kJ/mol; ph the phase law [Thi K, cp = a + bT + cT^2 + dT^3 + e/T^2 J/mol/K, latent J/mol at Thi], absent = UO2 on Fink. UO2 figures: rho 95 % TD, k near 900-1200 K (MATPRO), kint to melt (published), fusion Fink 2000. MOX is carried on UO2's figures. */
/* kg/mol of U-10Zr off the handbook's Zr atom fraction (SAS4A eq. 10.3-111) and U's 0.23803 */
const UZR_AZ=1.627*0.1/(0.6272+0.1), UZR_M=(1-UZR_AZ)*0.23803/0.9;
const FUEL=[
 {name:"UO2  3.2% LEU",beta:680,excess:6200,rho:10400,k:3.0,kint:6.3,M:.27003,muen:muenOf({U:1,O:2}),muAt:muOf({U:1,O:2}),hfus:70,alpha:1.0e-5,tdmg:1500,tmelt:3120,mass:0,
  note:"Low enrichment. The most forgiving kinetics you can buy at 680 pcm of delayed neutrons, but a short campaign and modest power density."},
 {name:"UO2  4.9% LEU",beta:650,excess:7200,rho:10400,k:3.0,kint:6.3,M:.27003,muen:muenOf({U:1,O:2}),muAt:muOf({U:1,O:2}),hfus:70,alpha:1.0e-5,tdmg:1500,tmelt:3120,mass:8,
  note:"Standard commercial fuel. Balanced across every axis and the baseline everything else is measured against."},
 {name:"UO2 19.7% HEU",beta:640,excess:10200,rho:10400,k:3.0,kint:6.3,M:.27003,muen:muenOf({U:1,O:2}),muAt:muOf({U:1,O:2}),hfus:70,alpha:1.0e-5,tdmg:1500,tmelt:3120,mass:-18,
  note:"Naval-grade enrichment. Far more excess reactivity and power density, so the core is smaller, but you need a lot of rod worth and boron to hold it down."},
 {name:"MOX PLUTONIUM",beta:300,excess:8500,rho:10400,k:3.0,kint:6.3,M:.27003,muen:muenOf({U:1,O:2}),muAt:muOf({U:1,O:2}),hfus:70,alpha:1.1e-5,tdmg:1450,tmelt:3050,mass:-12,
  note:"Dense and hot. Beta collapses to 300 pcm, which halves the distance to prompt criticality. Every reactivity mistake is twice as fast."},
 /* U-10Zr, IFR Metallic Fuels Handbook via SAS4A/SASSYS-1 5.7 ch. 10.3: rho 293 K Table 10.3.2, cp Billone eq. 10.3-108 (J/kg/K times M) with its 1506-1669 K melting-range excess over the liquid taken as fusion at the solidus, k eq. 9.8-36 at 800 K and integrated 773-1506 K */
 {name:"U-ZR METALLIC",beta:640,excess:8000,rho:16020,k:28.39,kint:28.97,M:UZR_M,muen:muenOf({U:1-UZR_AZ,Zr:UZR_AZ}),muAt:muOf({U:1-UZR_AZ,Zr:UZR_AZ}),hfus:(580.7-221.9)*(1669-1506)*UZR_M/1000,
  ph:[[1000,6.625*UZR_M,0.3066*UZR_M,0,0,4.58e6*UZR_M,0],[1506,180.1*UZR_M,0,0,0,0,0],[Infinity,221.9*UZR_M,0,0,0,0,0]],
  alpha:1.7e-5,tdmg:1150,tmelt:1506,mass:-25,
  note:"Metal fuel conducts heat roughly twice as well as ceramic, so fuel runs far cooler for the same power. Melts at a lower temperature though."},
 /* natural U metal: phases, cp and latent heats Kim & Hofman, ANL AAA Fuels Handbook (2003) sec. 2.6, Tables 2-13/2-14 (Oetting 1976); rho the Calder bar's (Nuclear Engineering, Dec. 1956); k IFR handbook via SAS4A Table 10.3.4 at 698 K and integrated from the 408 C can to 942 K; alpha off Imhoff LA-UR-21-21810 alpha-phase density; beta U-235 thermal only; excess the volume mean of Calder Hall's zone k-inf (Dec. 1956) at 425 C fuel; tdmg the alpha-beta change */
 {name:"U METAL NATURAL",beta:650,excess:6218,rho:18700,k:36.4,kint:10.21,M:.23803,muen:muenOf({U:1}),muAt:muOf({U:1}),hfus:9.142,
  ph:[[942,24.959,2.132e-3,2.370e-5,0,0,2791],[1049,42.928,0,0,0,0,4757],[1408,38.284,0,0,0,0,0],[Infinity,48.660,0,0,0,0,0]],
  alpha:7.97e-6,tdmg:942,tmelt:1408,mass:0,
  note:"Natural uranium metal, the first power fuel. Needs no enrichment and conducts heat very well, but it changes crystal form at 669 C and grows under irradiation, so it must be kept cool - which is why the reactors that burned it were huge."},
];
/* dens is what latMass() weighs the drawn band with: a reflector is a thickness on a face, not a flat tonnage. */
const REFL=[
 {name:"NONE",dRho:0,dV:0,dens:0,note:"Neutrons that leak out are lost. Simplest and lightest option, because there is nothing there."},
 {name:"STEEL",dRho:250,dV:0,dens:7.9,note:"Reflects some leakage back into the core, worth about 250 pcm at one ring of thickness. Dense, so a thick band is expensive."},
 {name:"BERYLLIUM",dRho:750,dV:120,dens:1.85,note:"The best reflector available, worth 750 pcm, and light enough to use thickly. Its (n,2n) reaction also pushes the void coefficient in the positive direction."},
 {name:"GRAPHITE",dRho:520,dV:60,dens:1.7,note:"Good reflector, cheap and light, with a mild positive shift to the void coefficient."},
];
const SCRAM=[
 {name:"GRAVITY DROP",rate:.45,mass:20,note:"Fail-safe on loss of power, but slow, and it slows further under hull acceleration."},
 {name:"SPRING ASSISTED",rate:.90,mass:45,note:"Twice as fast. Its accumulators must be kept charged to work."},
 {name:"BORON INJECTION",rate:2.5,mass:30,note:"Near instant. Irreversible: the loop stays poisoned for the rest of the mission."},
 {name:"MOTOR DRIVEN",rate:0.4/7,mass:20,note:"Every rod driven in by its own servo at 0.4 m/s, the RBMK-1000's 18-21 s over a 7 m core (INSAG-7). No faster than normal operation, so a scram is a slow push, not a drop."},
];
/* tipLen and tipGap are fractions of the core's height: the follower hangs tipGap under the absorber's tip, tipLen long; the displacer's are the RBMK-1000's 4.5 m and 1.25 m on a 7 m core (INSAG-7) */
const FOLL=[
 {name:"WATER",tipRho:0,tipLen:0,tipGap:0,mass:0,
  note:"Nothing below the absorber but coolant. Inserting the bank only ever removes reactivity, all the way in. The dull, safe, correct answer."},
 {name:"GRAPHITE DISPLACER",tipRho:1200,tipLen:4.5/7,tipGap:1.25/7,mass:-14,
  note:"A graphite follower keeps water out of the channel below the absorber, so the core wastes fewer neutrons on coolant and the bank is lighter and quicker. It also means the first thing a scram does is drive graphite through the BOTTOM of the core, adding reactivity down there before any absorber arrives. This is the Chernobyl scram."},
 {name:"BORATED STEEL",tipRho:-420,tipLen:0.4,tipGap:0,mass:34,
  note:"A poisoned follower. The bank bites early and there is no positive excursion anywhere in its travel, at the price of carrying that poison all campaign - and of the mass."},
];
/* `water` m³ of secondary water ONE generator holds at 100 % level, the whole of the boil-dry mechanic; a holdup is a VOLUME here as it is everywhere else, and `sgMassOf()` weighs it at the shell's own state - 74.3 m³ is the ~55 t a Westinghouse U-tube unit carries. `tubeV` m³ of PRIMARY water inside the tubes and heads, which is a different inventory on the other side of the wall: a Model F's 5626 tubes of 15.3 mm bore over 20 m hold 21 m³ and the channel head the rest, while a once-through unit is the other way round - little in the shell, a long bundle full of it. `tube` t of BUNDLE STEEL, the shell priced separately (sgSteelT(), layout.js). */
const SGT=[
 {name:"U-TUBE",water:74.3,tubeV:30,tube:63.3,note:"Large secondary water inventory acts as a heat sink for minutes after feedwater is lost. Heavy and slow to respond."},
 {name:"ONCE-THROUGH",water:9.5,tubeV:45,tube:41.1,note:"Very little water in it, so it responds instantly to load changes and boils dry almost as fast. Light."},
];
/* The MEAN over the generators drawn, never the sum - both readers are plant-wide flywheel terms - normalised so a stock plant reads exactly 1.0. */
const SG_MASS_REF = 72.25;   // t, re-measured 09/09/26 when the shell's stated volume became 74.3 m3
const sgInertiaK = () => { let n=0,m=0;
  for(const p of LAY.parts) if(p.role==="sg"){ m+=sgSteelT(p.id); n++; }
  return (n?m/n:SG_MASS_REF) / SG_MASS_REF; };
const BKP=[
 {name:"NONE",bk:0,mass:0,note:"Lose main power and the coolant pumps stop dead. Only natural circulation remains."},
 {name:"BATTERY BANK",bk:.5,mass:22,note:"Keeps one pump turning at half speed through a blackout."},
 {name:"DIESEL GENERATORS",bk:1.0,mass:58,note:"Full pump power independent of the plant. Heavy, and one more thing to maintain."},
];
COOLANT.forEach(a=>a.note=a.tie+". "+a.good+", but "+a.bad.replace(/^[A-Z]/,c=>c.toLowerCase())+".");
const BUDGET=3000;
/* Where the control bank stands at commissioning: boronated critical here, shutdown margin measured from here, resetPlant() starts here. */
const RODX0=.35;
/* `??`, never `||`, or a legitimate zone 0 falls through to the fallback. */
const zoneFuelOf = (c,z) => c.zoneFuel[z] ?? c.fuel;
const CORE_KEYS=["cool","fuel","zoneFuel","mod","refl","poison","pitch","hd","power","chim","scram","rodw","foll","nbank","rodD","rodP","clad","fin","rodSpd","absD","absN"];
const CORE_DEFAULT={cool:0,fuel:1,mod:0,refl:1,poison:400,pitch:1.0,hd:1.0,power:1200,chim:.3,scram:0,rodw:2600,foll:0,nbank:4};
const coreD = id => D.cores[id];
const priD = () => D.cores[primaryCore()] || coreNone();
const coreBag = id => (id!=null && D.cores[id]) || priD();
const ratedMWt = () => { let p=0; for(const id of coreIds()) p+=D.cores[id].power; return p; };
/* `raw` answers undefined for an absent key and set() deletes on it, so merely drawing a rail cannot mint a default and read as a design edit. */
const bagAcc = (bag,key,read,after) => ({
  get:read, raw:()=>bag[key],
  set:v=>{ if(v===undefined) delete bag[key]; else bag[key]=v; if(after) after(); }});
/* Layout caches key off DGEN: anything writing D.pipes, D.ports, D.fittings, D.tanks or a part's x,y must call dTouch(). */
// fraction of travel a second, and tonnes of drive gear per bank
const ROD_SPD0=0.012, ROD_BANK_T=9;
let DGEN=0;
const dTouch=()=>{ DGEN++; };
// a bench input landed: it may have written D by any path, and layFresh() spends it as a dTouch() before the next paint
let dEditPend=false;
const dEditMark=()=>{ dEditPend=true; };
const D={sg:0,
         rpsm:.35,rpsLag:.06,
         /* Fractions inserted the temperature controller may walk the bank between; not a safety limit, but it keeps the bank near where the shutdown margin was measured. */
         arLo:0.10, arHi:0.70,
         gw:60, gh:34,            // the hull, in grid cells
         bkp:1,fittings:{},
         feedT:undefined,         // K the feedwater reaches the shells at; unset = feedTSuggest()
         mat:{},
         /* Per-instance quantities in real units, keyed by part id. EMPTY means "whatever this design suggests"; nothing here clamps or ranges. */
         turbKgs:{},          // kg/s of steam a turbine swallows wide open
         condUA:{}, condDump:{},   // kW/K of condensing duty; kg/s of bypass
         sgUA:{}, ihxUA:{},   // kW/K per transfer stage
         pumpHead:{}, pumpFlow:{}, pumpRotor:{}, // MPa developed, at kg/s; seconds of rated shaft power stored
         sgType:{},radCoat:{},radArea:{},radUA:{},   // m2 of panel, and kW/K of its coolant side
         sgDesP:{},           // MPa each generator's own shell is built to hold
         bore:{},             // mm, per run key
         wall:{},             // mm, per run key
         /* NO STOCK PLUMBING DECLARED HERE: buildStockPlumbing() (pipenet.js) lays it through the same calls the bench hands the player. */
         runs:{},
         machines:{}, cores:{}, name:{}, blocks:{}, segs:["g1"],
         tanks:{}, pipes:{}, ports:{}, start:{}};

/* Where an actuator stands at commissioning; absent means "whatever resetPlant() hard-codes", so an untouched design commissions bit-identically. */
const startOf=(k,fallback)=>(D.start && D.start[k]!==undefined) ? D.start[k] : fallback;

/* designBake() states a figure per machine, so one left behind prices the next plant off the last one's core. Emptied in place: a reassignment strands a holder. */
const DBAGS=["turbKgs","condUA","condDump","sgUA","sgDesP","ihxUA","pumpHead","pumpFlow","pumpRotor",
             "sgType","radCoat","radArea","radUA","bore","wall","start"];
/* The scalars, taken before anything can edit them. */
const DSCAL=Object.fromEntries(Object.entries(D).filter(([,v])=>typeof v!=="object"));
/* For a caller that has just written the scalars it wants and cannot have designForget() put them back. */
const designForgetBags=()=>{ for(const b of DBAGS) for(const k in D[b]) delete D[b][k]; };
const designForget=()=>{ designForgetBags(); Object.assign(D,DSCAL); };
/* Everything that is not a DSCAL scalar is a table D ships empty, so no list has to be kept up to date. */
const designClear=()=>{
  for(const k in D) if(typeof D[k]==="object") for(const j in D[k]) delete D[k][j];
  Object.assign(D,DSCAL);
};

/* One row per figure that carries an AUTO key. The panel, designBake() and designAuto() read THIS list; nobody keeps a second one. */
let FIG_BATCH=false;
const figSide=fn=>{ if(fn && !FIG_BATCH) fn(); };
const figBag=(bag,key,get,after)=>({get, raw:()=>{ const v=bag[key]; return v==null?undefined:v; },
  set:v=>{ bag[key]=v; figSide(after); }, clr:()=>{ delete bag[key]; figSide(after); }});
const figCore=(id,bag,key,get,after)=>figBag(bag(coreD(id)),key,()=>get(coreD(id),id),after);
const FIG={
  /* commission() walks an UNSTATED UA onto rated power (step.js) and takes a stated one as the player's word: baking it stands that trim down */
  sgUA:     {subs:()=>roleAll("sg"), keep:true, acc:id=>figBag(D.sgUA,id,()=>sgUAOf(id))},
  sgDesP:   {subs:()=>roleAll("sg"),    acc:id=>figBag(D.sgDesP,id,()=>sgDesPOf(id))},
  ihxUA:    {subs:()=>ihxIds(),         acc:id=>figBag(D.ihxUA,id,()=>ihxUAOf(id))},
  pumpHead: {subs:()=>pumpIds(),        acc:id=>figBag(D.pumpHead,id,()=>pumpHead(id))},
  /* pumpBoxCap() reads the STORED flow, so stating this one grows the box a preset's pipework was routed round */
  pumpFlow: {subs:()=>pumpIds(), keep:true, acc:id=>figBag(D.pumpFlow,id,()=>pumpFlow(id))},
  pumpRotor:{subs:()=>pumpIds(),        acc:id=>figBag(D.pumpRotor,id,()=>pumpRotor(id))},
  turbKgs:  {subs:()=>roleAll("turb"),  acc:id=>figBag(D.turbKgs,id,()=>turbKgs(id))},
  condUA:   {subs:()=>roleAll("cond"),  acc:id=>figBag(D.condUA,id,()=>condUA(id))},
  condDump: {subs:()=>roleAll("cond"),  acc:id=>figBag(D.condDump,id,()=>condDump(id))},
  radArea:  {subs:()=>radIds(),         acc:id=>figBag(D.radArea,id,()=>radAreaOf(id))},
  radUA:    {subs:()=>radIds(),         acc:id=>figBag(D.radUA,id,()=>radUAOf(id))},
  /* the run's own name, never the derived key: runIdOf() is the one door D.bore and D.wall are written under */
  bore:     {subs:()=>pipeNetwork(),    acc:r=>figBag(D.bore,runIdOf(r),()=>runBoreMm(r),dTouch)},
  wall:     {subs:()=>pipeNetwork(),    acc:r=>figBag(D.wall,runIdOf(r),()=>runWallMm(r),dTouch)},
  rodD:     {subs:()=>coreIds(),        acc:id=>figCore(id,cD=>cD,"rodD",cD=>rodD(cD),()=>latRevolve(coreD(id)))},
  rodP:     {subs:()=>coreIds(),        acc:id=>figCore(id,cD=>cD,"rodP",cD=>rodPOf(cD),()=>latRevolve(coreD(id)))},
  fin:      {subs:()=>coreIds(),        acc:id=>figCore(id,cD=>cD,"fin",cD=>finOf(cD),()=>latRevolve(coreD(id)))},
  rodSpd:   {subs:()=>coreIds(),        acc:id=>figCore(id,cD=>cD,"rodSpd",cD=>rodSpdOf(cD),dTouch)},
  absD:     {subs:()=>coreIds(),        acc:id=>figCore(id,cD=>cD,"absD",cD=>absD(cD),()=>latRevolve(coreD(id)))},
  absN:     {subs:()=>coreIds(),        acc:id=>figCore(id,cD=>cD,"absN",cD=>absN(cD),()=>latRevolve(coreD(id)))},
  feedT:    {subs:()=>roleAll("turb"),  acc:()=>figBag(D,"feedT",()=>feedTOf(),dTouch)},
  vesselWall:{subs:()=>coreIds().filter(id=>!coreD(id).tube),
    acc:id=>figCore(id,cD=>cD,"wall",(cD,i)=>vesselWallMm(derived(i).P0,COOLANT[cD.cool],cD),dTouch)},
  coreDp:   {subs:()=>coreIds(),        acc:id=>figCore(id,cD=>cD,"dp0",(cD,i)=>coreDpOf(i),dTouch)},
  tubeBore: {subs:()=>coreIds().filter(id=>coreD(id).tube),
    acc:id=>figCore(id,cD=>cD.tube,"bore",cD=>tubeBoreMm(cD),dTouch)},
  tubeWall: {subs:()=>coreIds().filter(id=>coreD(id).tube),
    acc:id=>figCore(id,cD=>cD.tube,"wall",(cD,i)=>tubeWallMm(derived(i).P0,COOLANT[cD.cool],cD),dTouch)},
  cavVol:   {subs:()=>coreIds().filter(id=>coreD(id).tube),
    acc:id=>figCore(id,cD=>cD.tube,"cavVol",cD=>cavVolM3(cD),dTouch)},
  shieldT:  {subs:()=>coreIds().filter(id=>coreD(id).tube),
    acc:id=>figCore(id,cD=>cD.tube,"shieldT",cD=>shieldT(cD),dTouch)},
  holdP:    {subs:()=>tankIds().filter(id=>D.tanks[id].hold),
    acc:id=>figBag(D.tanks[id].hold,"p",()=>holdSetP(tankCircuit(id)))},
  /* off the drawing, so a valve is not baked against the last plant commissioned */
  fitLift:  {subs:()=>reliefFitsD(),    acc:fid=>figBag(D.fittings[fid],"lift",()=>reliefSetD(fid).lift)},
  fitReseat:{subs:()=>reliefFitsD(),    acc:fid=>figBag(D.fittings[fid],"reseat",()=>reliefSetD(fid).reseat)},
  matT:     {subs:()=>Object.keys(D.mat),
    acc:k=>figBag(D.mat[k],"t",()=>matThick(+k.split(",")[0],+k.split(",")[1]),buildLayout)},
};
const reliefFitsD=()=>Object.keys(D.fittings).filter(f=>D.fittings[f].mode==="relief");
const figBatch=fn=>{ FIG_BATCH=true; try{ return fn(); } finally { FIG_BATCH=false; } };
/* a run is its own object; everything else names itself, so one string is the subject either way */
const figKey=sub=>(sub && typeof sub==="object") ? runIdOf(sub) : sub;
const figWalk=(fn,all)=>{ for(const k in FIG){ const r=FIG[k]; if(r.keep && !all) continue;
  for(const sub of r.subs()) fn(r.acc(sub), figKey(sub)); } };
const figSettle=()=>{ for(const id of coreIds()) latRevolve(coreD(id)); buildLayout(); dTouch(); };
/* every value is READ before any is written: a figure resolved off one just baked would otherwise price itself off the write */
const designBake=only=>figBatch(()=>{
  const want=(a,k)=>(!only || only(k)) && a.raw()===undefined;
  /* asked before anything is settled, so a gesture that placed nothing costs a walk and touches neither the layout nor the lattice */
  let any=false; figWalk((a,k)=>{ if(want(a,k)) any=true; });
  if(!any) return;
  figSettle();                       // the bags were just emptied: every cache keyed on DGEN still holds the last plant's answers
  const w=[];
  figWalk((a,k)=>{ if(want(a,k)) w.push([a,a.get()]); });
  for(const [a,v] of w) a.set(v);
  figSettle();
});
const designAuto=()=>figBatch(()=>{ figWalk(a=>a.clr(),true); figSettle(); });
/* what a gesture PLACED states its own figures; anything already on the board keeps what it was left on, AUTO included */
const figSubs=()=>{ const s=new Set(); figWalk((a,k)=>s.add(k),true); return s; };
const designBakeSince=was=>designBake(k=>!was.has(k));
function designBakeNew(fn){
  const was=figSubs();
  const out=fn();
  designBakeSince(was);
  return out;
}

/* Swallow-weighted: efficiency is a property of the STEAM, and the steam splits by what each machine can take. */
const grossEff  = () => { let w=0,e=0;
  for(const p of LAY.parts) if(p.role==="turb"){
    const k=turbKgs(p.id); w+=k; e+=k*turbEffOf(p.id); }
  return COOLANT[priD().cool].eff * (w>0 ? e/w : 1); };
/* Both a share of what this plant actually MAKES, never of the core's rating, so condShort_() compares like with like. */
const loadCeil  = () => totalTurbKgs()/Math.max(1e-9, plantSteam());
const condCeil  = () => totalCondUA()/Math.max(1e-9, condUASuggest());
/* A brief overload is bought with backpressure, so only a gap wide enough to cost real output counts. */
const condShort_ = () => loadCeil() - condCeil() > 0.26;

const MOD_HALF=1.0, LAM_FAST=4.0e-7, LAM_TH=8.0e-5;
/* Fitted together so the three ARCHPRE drawings read published full-void worths (PWR -10000, RBMK +2500, SFR +700) as the slope at the operating point. */
const AV_MOD=12562.5, AV_ABS=1578.9, AV_FAST=631.5, AM_K=432;
/* Reactivity per unit core strain at a bare fast spectrum, pcm; fitted so BN-600's isothermal aM+aS lands near -3 pcm/K. */
const EXP_RHO=42000;
/* lam per second; sigK the burnout rate at rated flux in units of the xenon decay constant; XE_EQ0 pcm, the one fitted figure. */
const XE={lamI:Math.LN2/(6.57*3600), lamX:Math.LN2/(9.14*3600),
          gI:.0639, gX:.00237, sigK:3.0};
const XE_EQ0=2700;
// xenon after a trip, as a MULTIPLE of the equilibrium it started from
function xeAfter(hours){
  const li=XE.lamI, lx=XE.lamX, sig=XE.sigK*lx, t=hours*3600;
  const I0=(XE.gI+XE.gX)/li, X0=(XE.gI+XE.gX)/(lx+sig);
  const X=X0*Math.exp(-lx*t)+li*I0*(Math.exp(-li*t)-Math.exp(-lx*t))/(lx-li);
  return X/X0;
}
const XE_PEAK=(function(){ let x=1,h=0;
  for(let i=0;i<=48*4;i++){ const v=xeAfter(i/4); if(v>x){ x=v; h=i/4; } }
  return {x,h}; })();
/* Hours after a trip in which `avail` pcm still covers the xenon standing at that hour; null when the pit never closes, 0 when it is shut from the start. */
function xeWindow(avail,xeW){
  if(avail>=xeW*XE_PEAK.x) return null;
  for(let h=0;h<=48;h+=0.25) if(avail<xeW*xeAfter(h)) return h;
  return null;
}
const MR_PEAK=3.2, MR_STOCK=1.6, ETA_STOCK=0.95, FAST_RHO=0.773;
const MOD_A=0.337502, MOD_B=0.036845;
const modTherm = mr => mr/(mr+MOD_HALF);
/* Resonance escape times thermal utilisation, so it HAS A PEAK and a lattice can be over-moderated; MOD_A/MOD_B fit MR_PEAK and ETA_STOCK. */
const modEta = mr => mr>1e-9 ? Math.exp(-MOD_A/mr)/(1+MOD_B*mr) : 0;
const ETA_S=modEta(MR_STOCK);
const modEtaN = mr => modEta(mr)/ETA_S;
/* NOT divided by eta(mr): unnormalised it vanishes with the thermal chain, so a fast core reads no moderator coefficient rather than an enormous one. */
const modEtaSlope = mr => { const h=1e-6*Math.max(mr,1e-3);
  return mr*(modEta(mr+h)-modEta(mr-h))/(2*h)/ETA_S; };
/* The thermal chain PLUS a fast route, or a core with no moderator would read zero excess rather than living on fast fission. */
const modK = (mr,mth) => modEtaN(mr)+FAST_RHO*Math.pow(1-mth,3);

const coreIdOf = c => { for(const id in D.cores) if(D.cores[id]===c) return id; return null; };
/* Warnings here are tagged by ROLE; coreWarns() retags them by id. */
function coreFig(c){
  const a=COOLANT[c.cool],f=fuelBlend(c),rf=REFL[c.refl],M=latM(c);
  const cid=coreIdOf(c), ci=cid ? coreCircOf(cid) : nodeGraph().coreCirc;
  const P0=holdSetP(ci);   // MPa
  const dens=M.vol>1e-9? c.power/M.vol : 0;   // kW/L
  const coreMass=M.vol*22*(0.8+0.2*c.hd);
  /* A tube core's boundary is the channel, so its rating is the tube's and its mass every tube plus the shield over the cavity. */
  const vesselMass=c.tube ? tubeMass(P0,a,c)+shieldT(c) : vesselShellMass(P0,a,c),
        vesselRated=c.tube ? tubeRating(P0,a,c) : vesselRating(P0,a,c),
        vesselBurst=vesselRated*PIPE_BURST_K;
  const mass =
      a.mass + f.mass + SCRAM[c.scram].mass
    + coreMass + vesselMass + c.chim*38 + latMass(c)
    + FOLL[c.foll].mass + (c.nbank-4)*ROD_BANK_T
    + c.nbank*ROD_BANK_T*(rodSpdOf(c)/ROD_SPD0-1);
  const mr=modRatio(c), mth=modTherm(mr), Lam=LAM_FAST*Math.pow(LAM_TH/LAM_FAST,mth);
  const sh=modShares(c), fast=Math.pow(1-mth,3);
  /* the blocks' half runs on their own temperature where the moderator has one, and on the water's where it has none */
  const aBlk=mth*MODER[c.mod].aT*sh.block, own=modOwnT(c);
  const aM=mth*(-AM_K*modEtaSlope(mr)*sh.cool)+(own?0:aBlk), aG=own?aBlk:0;
  const graph=own ? {kg:latModT(c)*1000, dT:COOLANT[c.cool].dTg} : {kg:0, dT:0}, hs=heatShares(c);
  const aV=AV_MOD*(modEtaN(modRatio(c,true))-modEtaN(mr))+AV_ABS*modAbs(c)
          +AV_FAST*fast+rf.dV;
  /* aX runs on the pellet's own temperature, aS on the coolant's. */
  const driveline=-STEEL_A*c.rodw*(1-Math.cos(2*Math.PI*RODX0));
  const aX=-EXP_RHO*fast*f.alpha;
  const aS=-EXP_RHO*fast*STEEL_A*2+driveline;
  /* rf.dRho is already in the albedo corePredict() reads, so leak carries it. */
  const core=corePredict(c,{dens,rf});
  const leak=core.leak;
  const excess=f.excess*modK(mr,mth)-cladOf(c).abs*modClad(c)-c.poison-leak;
  const Fq=core.FqCold;
  /* The margin at rated is PEAK_M by construction, so dnbr0 is the coolant's own level. */
  const bind=latQLim(c), dnbr0=a.dnbr;
  const graceK=a.grace*sgInertiaK();
  const xeW=XE_EQ0*a.xe;
  const rodS=x=>c.rodw*(x-Math.sin(2*Math.PI*x)/(2*Math.PI));
  const boronOp=-(excess-rodS(RODX0)-xeW);
  /* What locks a restart out is the PEAK hours after the trip, not the equilibrium the plant was commissioned with. */
  const xePit=xeW*XE_PEAK.x;
  const xeWin=xeWindow(excess-rodS(RODX0),xeW);
  // pcm the core gives back from zero to full power: every coefficient on the pellet, over its own rise
  const pwrDef=(a.aF+aX)*pinDTf(c);
  const dopBack=-pwrDef;                         // released as the fuel cools to the coolant
  const sdm=rodS(1)-rodS(RODX0)-xeW-dopBack;     // bank only
  const sdmB=sdm+(6000+boronOp);                 // bank plus everything the boron system has left
  return {a,f,rf,dens,mass,aM,aG,graph,hs,aV,aX,aS,pwrDef,Lam,mr,mth,excess,dnbr0,bind,Fq,xeW,core,
    boronOp,sdm,sdmB,leak,xePit,xeWin,power:c.power,
    grace:graceK*25/Math.sqrt(c.power/1200)*(1+.4*c.chim),
    beta:f.beta,scram:SCRAM[c.scram].rate,P0,vesselMass,vesselRated,vesselBurst,
    warn:(()=>{const w=[];
      if(sdmB<200) w.push(["RED","Even full boration holds this core down by only "+sdmB.toFixed(0)+" pcm after a trip. Nothing on the plant can shut it down and keep it down - add control bank worth or burnable poison.","rods"]);
      else if(sdm<200) w.push(["SOFT","The bank alone holds this core down by only "+sdm.toFixed(0)+" pcm. Once the xenon decays after a trip the core goes critical again with the bank fully inserted. You must borate after every scram; full boron is worth "+sdmB.toFixed(0)+" pcm of margin.","rods"]);
      if(boronOp<-6000) w.push(["RED","Boron demand "+boronOp.toFixed(0)+" pcm exceeds the 6000 pcm chemical system. Add burnable poison or drop enrichment.","core"]);
      /* Positive boronOp means the chemical system would have to hold the core UP, and nothing can. */
      else if(boronOp>0) w.push(["RED","This core is "+boronOp.toFixed(0)+" pcm short of critical with the bank at its commissioning position. There is nothing to take out - buy higher enrichment, remove burnable poison, or moderate it.","core"]);
      if(aV>0) w.push(["SOFT","Positive void coefficient ("+aV.toFixed(0)+" pcm). Steam in the core ADDS power. This is the Chernobyl feedback loop.","core"]);
      if(aM+aG>0) w.push(["SOFT","Positive moderator coefficient. Heating the moderator raises power instead of lowering it - an over-moderated lattice, or a graphite stack in one.","core"]);
      if(pwrDef>-100) w.push(["SOFT","Power coefficient only "+pwrDef.toFixed(0)+" pcm from zero to full power. Almost nothing in the fuel pushes back when power rises; the rods and the coolant are all that hold it.","core"]);
      if(f.beta<400) w.push(["SOFT","Beta "+f.beta+" pcm. Prompt criticality is half as far away as with uranium fuel.","core"]);
      if(FOLL[c.foll].tipRho>0 && aV>0) w.push(["SOFT","Graphite followers on a positive-void core. Inserting the bank pushes graphite through the bottom of the core, which ADDS reactivity there before the absorber removes any. A scram from a withdrawn bank is an excursion, not a shutdown.","rods"]);
      if(core.cz<0.35) w.push(["SOFT","Loosely coupled core (axial coupling "+core.cz.toFixed(2)+"). It is tall enough that one end can drift without the other noticing, so xenon can oscillate top to bottom on its own.","core"]);
      if(Fq>3.0) w.push(["SOFT","Peaking factor "+Fq.toFixed(2)+". The hottest spot runs at "+Fq.toFixed(1)+"x the core average, and DNBR is set by that spot, not by the average.","core"]);
      return w;})()};
}
function coreWarns(id){
  const c=coreD(id), rods=rodsOf(id);
  return coreFig(c).warn.concat(latWarn(c))
    .map(w=>[w[0],w[1], w[2]==="core" ? id : w[2]==="rods" ? rods : w[2]]);
}
/* No id: the plant, with the FIRST vessel's own figures spread over it. */
function derived(id){
  if(id!=null) return coreFig(coreBag(id));
  const d=coreFig(priD());
  const cores=coreIds();
  /* A containment is a closed shape in the paint, so "is there one" is "did a fill come back bounded". */
  const conts=matRegionsBounded();
  const contRel=conts.length ? Math.min.apply(null, conts.map(g=>contRelAt(null, g.cells[0]%GW, (g.cells[0]/GW)|0))) : 1;
  /* No paint term: layMass (layoutMetrics(), layout.js) already carries it. */
  let mass=0; for(const cid of cores) mass+=coreFig(coreD(cid)).mass;
  mass+=totalPumpMass()+totalSgMass()
    +(roleOf("bkp")?BKP[D.bkp].mass:0)
    + partMass("catcher") + partMass("vent") + partMass("inert") + partMass("pan")
    + tankMass() + fittingMass()
    + (roleOf("ctrl")?55:0)
    + totalTurbMass() + totalCondMass()
    + totalIhxMass() + totalRadMass()
    + layMass;
  const eff=grossEff(), loadMax=loadCeil(), condCap=condCeil(), condShort=condShort_();
  // under 1 the turbine trips at rest; under 1/DUMP_COND_K the dump is blocked
  const condMargin=TURB_TRIP_P/Math.max(COND_P0, psatSec(condRest(plantDuty()).condT));
  const w=[];
  if(mass>BUDGET) w.push(["RED","Over the "+BUDGET+" t mass budget by "+(mass-BUDGET).toFixed(0)+" t.",null]);
  for(const cid of cores) for(const x of coreWarns(cid)) w.push(x);
  const tightPainted=matCells().some(k=>{ const i=k.indexOf(",");
    return matWall(+k.slice(0,i),+k.slice(i+1)); });
  if(!conts.length) w.push(["SOFT", tightPainted
    ? "The gas-tight structure on this ship encloses nothing - every fill round it reaches the hull, so there is no containment. Close the shape, or accept that a release goes straight to the crew."
    : "No containment. Nothing painted on this ship is gas-tight, so any fuel damage releases straight to the crew - paint a closed shape in a gas-tight material to hold it in.",null]);
  else { const weak=conts.map(g=>{ let lo=Infinity, at=null;
           for(const i of g.wall){ const x=i%GW, y=(i/GW)|0, r=matRating(x,y);
             if(r<lo){ lo=r; at=[x,y]; } }
           return {g,lo,at}; }).sort((a,b)=>a.lo-b.lo)[0];
         if(weak.at && weak.lo < MAT_PDES)
           w.push(["SOFT","The containment is walled for only "+weak.lo.toFixed(2)+" MPa at "+weak.at[0]+","+weak.at[1]+" - the middle of its longest flat side, against a "+MAT_PDES+" MPa design. Thicken the wall there, or draw the enclosure rounder so no cell is in the middle of a long span.",null]); }
  if(D.bkp===0) w.push(["SOFT","No backup power. A blackout stops the pumps entirely.","bkp"]);
  if(roleAll("sg").length && feedTOf() >= if97Tsat(sgDesignP())) w.push(["RED","Feedwater arrives at "+feedTOf().toFixed(0)+" K, at or above the "+if97Tsat(sgDesignP()).toFixed(0)+" K the shells boil at. It would flash before it reached them - lower the feed temperature on the turbine or raise the shell pressure.","turb"]);
  if(!roleAll("turb").length) w.push(["SOFT","No turbine on the plant. This design generates no electricity at all.","turb"]);
  else if(!roleAll("cond").length) w.push(["SOFT","No condenser on the plant. The turbine has nowhere to exhaust steam to, so it does no work either - no electricity.","cond"]);
  if(roleAll("turb").length && loadMax<1.10) w.push(["SOFT","The turbine takes "+(loadMax*100).toFixed(0)+"% of the steam this plant raises at full power, so there is almost no overload left in it. In combat the reactor can be pushed past full power and this machine cannot take the extra steam. A bigger swallow buys the reach, and costs mass.","turb"]);
  if(condMargin<1/DUMP_COND_K) w.push([condMargin<1?"RED":"SOFT","The sink rests at "+(TURB_TRIP_P/condMargin).toFixed(4)+" MPa of backpressure against a "+TURB_TRIP_P+" MPa turbine trip"+(condMargin<1?", so the turbine trips before anything has happened":", so the steam dump is blocked at rest: a load drop goes to the shell safeties and the water does not come back")+". Bigger panels or a bigger condenser buy the margin.","cond"]);
  if(condShort) w.push(["SOFT","The condenser handles "+(condCap*100).toFixed(0)+"% of full-load duty but the turbine can draw "+(loadMax*100).toFixed(0)+"%. Past its duty it sits hotter, the exhaust pressure climbs and the turbine gives back part of what it made - continuously, not just in a transient. The reactor goes on making the heat either way.","cond"]);
  if(!scramWiredD()) w.push(["SOFT","No reactor protection system. Nothing in the control cabinet lands on a scram, so nothing will shut this core down for you - not high flux, not low DNBR, not a dry loop. Every trip is yours to call by hand.","ctrl"]);
  if(Object.keys(D.blocks).length && !roleOf("ctrl")) w.push(["SOFT","Automation is wired but there is no control room to house it. Every block in the cabinet computes nowhere: the demands they drive stay by hand until a CONTROL is placed.","ctrl"]);
  /* Topological only: hasHeatSink() reads the wiring, not the loop. */
  if(!hasHeatSink()) w.push(["SOFT","This design has no heat sink. Nothing wired to the primary loop removes heat from it.",null]);
  if(!radIds().length) w.push(["RED","No radiator on this ship. Nothing rejects the waste heat, so the condenser will climb until it loses vacuum and the turbine trips.","cond"]);
  else {
    const blind=radIds().filter(id=>!radLive(id));
    for(const id of blind) w.push(["SOFT",partOf(id).name+" cannot see space. A panel with no face on the skin radiates nothing at all - move it against the hull, or it is dead weight and the plant loses the sink it was bought for.",id]);
    const tr=radTRated(eff);
    if(tr>RAD_TDES+1) w.push(["SOFT","The panels are short of rated rejection: at full power they sit at "+tr.toFixed(0)+" K against a design "+RAD_TDES+" K, which puts the condenser near "+psatSec(Math.min(tr+COND_DT0,500)).toFixed(4)+" MPa of backpressure and the turbine gives part of its work back.","cond"]);
  }
  return Object.assign(d,{mass,over:mass>BUDGET,rated:ratedMWt(),contRel,nCont:conts.length,
    eff,loadMax,condCap,condShort,condMargin,warn:w});
}

/* HARD is the only severity that refuses to commission; RED is a fault the bench draws in red and still builds. */
const warnHard=w=>w[0]==="HARD";
const warnRed=w=>w[0]==="HARD"||w[0]==="RED";
