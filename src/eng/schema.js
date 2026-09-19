"use strict";
/* The one declaration of engine state. Row: [name, type, dim, init, store].
   type: f64 f32 i32 u8. dim: a key of PT.n (engBuild); "plant" rows are slots of ST.sc and must be f64.
   store: "s" = state (in the snapshot buffer), "x" = tick scratch (its own buffer, never snapshotted). */
const SCHEMA = [
  // plant scalars
  ["t","f64","plant",0], ["tick","f64","plant",0],
  ["n","f64","plant",0], ["I","f64","plant",0], ["X","f64","plant",0], ["Tf","f64","plant",0],
  ["Tavg","f64","plant",0], ["dTavg","f64","plant",0], ["P","f64","plant",0], ["pCore","f64","plant",0],
  ["rodPos","f64","plant",0], ["rodDem","f64","plant",0], ["rodJam","f64","plant",0], ["rodBand","f64","plant",0],
  ["scrammed","f64","plant",0], ["split","f64","plant",0], ["reGang","f64","plant",0],
  ["tilt","f64","plant",0], ["tiltDem","f64","plant",0], ["TfHot","f64","plant",0],
  ["load","f64","plant",1], ["loadDem","f64","plant",1], ["flowNet","f64","plant",1],
  ["lvl","f64","plant",0], ["dLvl","f64","plant",0], ["inv","f64","plant",100],
  ["turbWk","f64","plant",0], ["turbP","f64","plant",0], ["condVent","f64","plant",0], ["condVentSeen","f64","plant",0],
  ["condT","f64","plant",0], ["cwInT","f64","plant",0],
  ["dmg","f64","plant",0], ["fatigue","f64","plant",0], ["dnbr","f64","plant",0], ["rho","f64","plant",0],
  ["voidTh","f64","plant",0], ["cav","f64","plant",0], ["vf","f64","plant",0], ["fq","f64","plant",1],
  ["ao","f64","plant",0], ["ro","f64","plant",0], ["decay","f64","plant",0], ["heat","f64","plant",0],
  ["meltFrac","f64","plant",0], ["oxMax","f64","plant",0], ["qOx","f64","plant",0],
  ["rbHot","f64","plant",0], ["breach","f64","plant",0], ["melt","f64","plant",0], ["trip","f64","plant",0],
  ["turbTrip","f64","plant",0], ["condLost","f64","plant",0], ["blackout","f64","plant",0],
  ["nat","f64","plant",0], ["release","f64","plant",0], ["annRev","f64","plant",0],
  ["massRes","f64","plant",0], ["massWarn","f64","plant",0], ["massWarnT","f64","plant",0],
  ["arLo","f64","plant",0], ["arHi","f64","plant",1], ["sgtr","f64","plant",0],
  ["dose","f64","plant",0], ["crewDose","f64","plant",0], ["doseRate","f64","plant",0], ["repRate","f64","plant",0],
  ["partySpent","f64","plant",0], ["bkpLost","f64","plant",0],
  ["boron","f64","plant",0], ["boron0","f64","plant",0], ["boronDem","f64","plant",0],
  ["perN","f64","plant",0], ["perT","f64","plant",0], ["perV","f64","plant",Infinity],
  ["seed","f64","plant",0], ["rng","f64","plant",0], ["diceOff","f64","plant",0],
  ["coreDT","f64","plant",0], ["injRate","f64","plant",0], ["sgtrRate","f64","plant",0], ["spillRate","f64","plant",0],
  ["roomMax","f64","plant",T_HULL], ["roomMaxAt","f64","plant",-1], ["roomBurnOn","f64","plant",0], ["roomFireOn","f64","plant",0],
  ["roomBang","f64","plant",0], ["roomPMax","f64","plant",0],
  ["spinV","f64","plant",0], ["spinTV","f64","plant",0], ["sc","f64","plant",0],
  ["portShutGen","f64","plant",0], ["sgBurstGen","f64","plant",0],
  ["blastN","f64","plant",0], ["blastAt","f64","plant",-1],
  ["burnKg","f64","plant",0], ["burnP","f64","plant",0], ["burnBlast","f64","plant",0],
  ["fireKg","f64","plant",0], ["fireP","f64","plant",0], ["fireQ","f64","plant",0],
  ["hbPrompt","f64","plant",0], ["hbDecay","f64","plant",0], ["hbHeat","f64","plant",0], ["hbRemoval","f64","plant",0], ["hbDTavg","f64","plant",0],
  ["evHead","f64","plant",0], ["evCount","f64","plant",0], ["tripArg","f64","plant",-1],
  // reactivity parts (RP_*) and decay groups, plant aggregate
  ["parts","f64","rp",0], ["dec","f64","decGrp",0],
  // per circuit (circuit index from nodeGraph())
  ["PBy","f64","circ",0], ["TavgBy","f64","circ",0], ["dTavgBy","f64","circ",0], ["invBy","f64","circ",0], ["scBy","f64","circ",0],
  // per tank
  ["tank","f64","tank",0], ["lvlBy","f64","tank",0], ["dLvlBy","f64","tank",0], ["holdPBy","f64","tank",0],
  ["tankOpen","u8","tank",0], ["tankDump","u8","tank",0], ["tankByp","u8","tank",0], ["burstBy","u8","tank",0],
  ["tankOver","f64","tank",0], ["tankAuto","u8","tank",0], ["tankRate","f64","tank",0],
  // per pump
  ["flowBy","f64","pump",0], ["flowDemBy","f64","pump",0], ["cavP","f64","pump",0], ["pumpQBy","f64","pump",0],
  // per boiler (sg shells and drums, boilerIds() order)
  ["fregBy","f64","boiler",0], ["fregDemBy","f64","boiler",0], ["sgTBy","f64","boiler",0], ["steamBy","f64","boiler",0],
  ["sgFedBy","f64","boiler",0], ["sgPBy","f64","boiler",0], ["sgVentBy","f64","boiler",0], ["hbSgQ","f64","boiler",0],
  // per steam generator (sgIds() order)
  ["sgShare","f64","sg",0], ["sgWastBy","f64","sg",0], ["sgSwQBy","f64","sg",0], ["sgPwQBy","f64","sg",0],
  ["sgH2By","f64","sg",0], ["sgBurst","u8","sg",0], ["sgtrBy","f64","sg",0],
  // per ihx
  ["ihxQBy","f64","ihx",0],
  // per relief fitting
  ["reliefOpen","u8","relief",0], ["reliefAuto","u8","relief",0], ["reliefStuck","u8","relief",0],
  ["reliefBlocked","u8","relief",0], ["reliefArm","u8","relief",0], ["reliefSteam","f64","relief",0], ["reliefVent","f64","relief",0],
  // per throttle fitting
  ["valve","f64","throttle",1], ["valveDem","f64","throttle",1],
  // per condenser, per radiator panel
  ["condTBy","f64","cond",0], ["condPBy","f64","cond",0], ["cwInTBy","f64","cond",0], ["cwFlowBy","f64","cond",0],
  ["radTBy","f64","rad",0], ["radQBy","f64","rad",0],
  // per port, per run
  ["portShut","u8","port",0], ["flowPos","f64","run",0], ["runT","f64","rseg",-1],
  // per damageable part (machines, tanks, fittings, ports, pipe cells, mat cells)
  ["dmgBy","u8","part",0], ["dmgWhy","i32","part",0], ["roomHurt","f64","part",0], ["roomCrush","f64","part",0],
  ["partT","f64","part",-1], ["skinQ","f64","part",0], ["burnEvBy","u8","part",0], ["panBy","f64","part",0],
  // per network node
  ["hBy","f64","node",NaN], ["pBy","f64","node",NaN], ["mBy","f64","node",NaN], ["bBy","f64","node",0],
  ["h2By","f64","node",0], ["metalT","f64","node",0],
  // network (NaN in hBy/pBy/mBy/natPBy = not carried yet)
  ["natTick","f64","plant",0], ["natHas","f64","plant",0], ["netFacId","f64","plant",0],
  ["rcmFree","i32","node",0,"x"],
  ["edW","f64","edge",0], ["edWHas","u8","edge",0], ["edGRef","f64","edge",0], ["capRef","f64","node",0], ["fixRef","u8","node",0],
  ["natPBy","f64","node",NaN], ["natLoop","f64","loop",0],
  ["tankLive","u8","tank",1], ["turbGate","f64","turb",0], ["turbWorkFr","f64","turb",0],
  ["condStC","f64","cond",0], ["condStW","f64","cond",0], ["condStP","f64","cond",0],
  ["edQ","f64","edge",0,"x"], ["edChoke","u8","edge",0,"x"], ["gG","f64","edge",0,"x"], ["gH","f64","edge",0,"x"],
  ["gLive","u8","edge",0,"x"], ["pcMask","u8","edge",0,"x"], ["wSave","f64","edge",0,"x"], ["wSaveHas","u8","edge",0,"x"],
  ["fP","f64","node",0,"x"], ["fRho","f64","node",0,"x"], ["fRhoD","f64","node",0,"x"], ["fRhoG","f64","node",0,"x"],
  ["fRhoL","f64","node",0,"x"], ["fX","f64","node",0,"x"], ["fMu","f64","node",0,"x"], ["fVoid","u8","node",0,"x"],
  ["fWet","u8","node",1,"x"], ["fB","u8","node",0,"x"], ["fLp","f64","node",NaN,"x"], ["fLh","f64","node",NaN,"x"],
  ["fLm","f64","node",NaN,"x"], ["fedIn","f64","node",0,"x"], ["fTs","f64","node",0,"x"], ["fRfs","f64","node",0,"x"], ["fRgs","f64","node",0,"x"], ["hStr","f64","node",0,"x"], ["pStr","f64","node",0,"x"],
  ["stCap","f64","node",0,"x"], ["stSrc","f64","node",0,"x"], ["stPin","u8","node",0,"x"],
  ["stKp","f64","node",NaN,"x"], ["stKh","f64","node",NaN,"x"], ["stKm","f64","node",NaN,"x"], ["stP0","f64","node",0,"x"], ["stC","f64","node",0,"x"],
  ["fixV","f64","node",0,"x"], ["fixHas","u8","node",0,"x"], ["orderMask","u8","node",0,"x"],
  ["nb","f64","node",0,"x"], ["nx","f64","node",0,"x"], ["nTouch","u8","node",0,"x"], ["nRow","i32","node",0,"x"],
  ["nFree","i32","node",0,"x"], ["nDeg","u8","node",0,"x"], ["pSolve","f64","node",NaN,"x"],
  ["pcOf","i32","node",0,"x"], ["pcStack","i32","node",0,"x"], ["pcFree","u8","node",0,"x"], ["pcWet","u8","node",0,"x"],
  ["pcLo","f64","node",0,"x"], ["hlSeen","u8","node",0,"x"], ["pairMark","f64","pair",0,"x"],
  ["hlVal","u8","circ",0,"x"], ["hlStamp","f64","circ",-1,"x"],
  ["rcmDeg","i32","node",0,"x"], ["rcmQ","i32","node",0,"x"], ["rcmSeen","u8","node",0,"x"], ["rcmNb","i32","node",0,"x"],
  ["mA","f64","mat",0,"x"], ["mD0","f64","node",0,"x"], ["mDeg","u8","node",0,"x"], ["mC","f64","node",0,"x"], ["mR","f64","node",0,"x"],
  ["netRunW","f64","key",0,"x"], ["netLoop","f64","loop",0,"x"], ["netCoreKg","f64","core",0,"x"], ["netTankQ","f64","tank",0,"x"],
  ["netSgSteam","f64","boiler",0,"x"], ["netFeed","f64","boiler",0,"x"], ["netSgtr","f64","sg",0,"x"],
  ["netRelief","f64","relief",0,"x"], ["netBrk","f64","brk",0,"x"], ["netSc","f64","netSc",0,"x"],
  ["regPMean","f64","region",0,"x"], ["regCnt","f64","region",0,"x"], ["cellP","f64","cell",0,"x"],
  // room: solver carry, INJECT and repair slots, damage generation
  ["roomCgIt","f64","plant",0], ["liqCgIt","f64","plant",0], ["dmgGen","f64","plant",0],
  ["injKind","f64","plant",0], ["injDem","f64","plant",0], ["injCell","f64","plant",-1], ["injNode","f64","plant",-1],
  ["repA","f64","plant",-1], ["repT","f64","plant",0], ["repNeed","f64","plant",0],
  ["gsX","f64","cell",0], ["gsDisp","f64","cell",0], ["evLatch","u8","evLatch",0],
  ["rSrc","f64","cell",0,"x"], ["rD","f64","cell",0,"x"], ["rD2","f64","cell",0,"x"], ["rY","f64","cell",0,"x"],
  ["gsP","f64","cell",0,"x"], ["gsMol","f64","cell",0,"x"], ["gsVg","f64","cell",0,"x"], ["gsDI","f64","cell",0,"x"], ["gsAx","f64","cell",0,"x"],
  ["gsAy","f64","cell",0,"x"], ["gsB","f64","cell",0,"x"], ["gsR","f64","cell",0,"x"], ["gsZ","f64","cell",0,"x"],
  ["gsD","f64","cell",0,"x"], ["gsAp","f64","cell",0,"x"], ["gsJ","f64","cell",0,"x"], ["gsFx","f64","cell",0,"x"],
  ["gsFy","f64","cell",0,"x"], ["gsOut","f64","cell",0,"x"], ["gsF","f64","cell",0,"x"], ["gsM0","f64","cell",0,"x"],
  ["gsK","f64","cell",0,"x"], ["gsKi","f64","cell",0,"x"], ["gsIn","f64","cell",0,"x"], ["gsY0","f64","cell",0,"x"],
  ["gsY","f64","cell",0,"x"],
  ["lqP","f64","cell",0,"x"], ["lqH","f64","cell",0,"x"], ["lqHc","f64","cell",0,"x"], ["lqCap","f64","cell",0,"x"],
  ["lqComp","f64","cell",0,"x"], ["lqAx","f64","cell",0,"x"], ["lqAy","f64","cell",0,"x"], ["lqAyD","f64","cell",0,"x"],
  ["lqB","f64","cell",0,"x"], ["lqX","f64","cell",0,"x"], ["lqFx","f64","cell",0,"x"], ["lqFy","f64","cell",0,"x"],
  ["lqM0","f64","cell",0,"x"], ["lqDI","f64","cell",0,"x"], ["lqGas","f64","cell",0,"x"], ["lqAwx","f64","cell",0,"x"],
  ["lqAwy","f64","cell",0,"x"], ["lqLcap","f64","cell",0,"x"], ["lqLat","f64","cell",0,"x"],
  ["lqFull","u8","cell",0,"x"], ["lqStand","u8","cell",0,"x"], ["lqStiff","u8","cell",0,"x"],
  ["rFireQ","f64","cell",0,"x"], ["rPlW","f64","cell",0,"x"], ["rGdW","f64","cell",0,"x"], ["rPStat","f64","cell",0,"x"],
  ["rBx","f64","cell",0,"x"], ["rBy","f64","cell",0,"x"], ["rGx","f64","cell",0,"x"], ["rGUp","f64","cell",0,"x"],
  ["rGDn","f64","cell",0,"x"], ["rHole","u8","cell",0,"x"],
  ["rPlSeen","i32","cell",0,"x"], ["rPlQ","i32","cell",0,"x"], ["rPlRing","i32","cell",0,"x"], ["rGdQ","i32","cell",0,"x"],
  ["rGdSeen","i32","cell",0,"x"], ["rGdI","i32","cell",0,"x"], ["rCells","i32","cell",0,"x"], ["rCells2","i32","cell",0,"x"],
  ["rHoleWas","u8","paint",0,"x"], ["rGen","i32","rScal",0,"x"], ["rAcc","f64","rScal",0,"x"],
  // per annunciator row
  // transport and books (transport.js)
  ["h2","f64","plant",0], ["outPri","f64","plant",0], ["outSec","f64","plant",0], ["advClamped","f64","plant",0],
  ["enRes","f64","plant",0], ["enClamp","f64","plant",0], ["enOut","f64","plant",0], ["enSrc","f64","plant",0],
  ["massOut","f64","massTerm",0], ["spillBy","f64","brk",0],
  ["feedInH","f64","boiler",NaN], ["feedInM","f64","boiler",0], ["coreInH","f64","core",NaN],
  ["outKg","f64","out",0], ["outE","f64","out",0], ["outH2","f64","out",0],
  ["edgeKg","f64","edge",0], ["landed","f64","node",0], ["pAdv","f64","node",NaN],
  ["tSrc","f64","node",0,"x"], ["tMetQ","f64","node",0,"x"], ["tH2Take","f64","node",0,"x"],
  ["tMOut","f64","node",0,"x"], ["tMIn","f64","node",0,"x"], ["tInH","f64","node",0,"x"], ["tInM","f64","node",0,"x"],
  ["tInB","f64","node",0,"x"], ["tInC","f64","node",0,"x"], ["tOutH","f64","node",0,"x"], ["tOutB","f64","node",0,"x"],
  ["tOutC","f64","node",0,"x"], ["tKOut","f64","node",1,"x"], ["tKIn","f64","node",1,"x"], ["tPMax","f64","node",0,"x"],
  ["tPNow","f64","node",0,"x"], ["tVIn","f64","node",0,"x"], ["tGOut","f64","node",0,"x"], ["tLIn","f64","node",0,"x"],
  ["tLOut","f64","node",0,"x"], ["tHIn0","f64","node",0,"x"], ["tKH","f64","node",1,"x"], ["tSeedT","f64","node",NaN,"x"],
  ["tSeedQ","i32","node",0,"x"], ["tSeen","u8","node",0,"x"], ["tRiseOut","f64","node",0,"x"], ["tRiseK","f64","node",1,"x"],
  ["tFrom","i32","edge",-1,"x"], ["tM","f64","edge",0,"x"], ["tGasK","f64","edge",0,"x"], ["tLiqK","f64","edge",0,"x"],
  ["tEH","f64","edge",0,"x"], ["tEC","f64","edge",0,"x"], ["tRiseKg","f64","rise",0,"x"], ["tInj","u8","tank",0,"x"],
  // machines and the control cabinet (machines*.js); the wiring and the knobs are state because act() changes them live
  ["blkIn","i32","blockIn",-1], ["blkKn","f64","blockKnob",NaN], ["blkOn","u8","block",1], ["blkOutV","f64","block",0], ["blkOutF","f64","block",0],
  ["stgT","f64","stage2",0,"x"], ["stgX","f64","stage2",0,"x"], ["stgFl","f64","stage2",0,"x"], ["stgC","f64","stage2",0,"x"], ["stgW","f64","stage2",0,"x"], ["stgN","i32","stage2",-1,"x"],
  ["selW","f64","sel3",0,"x"], ["ctlDeg","i32","block",0,"x"], ["ctlOrd","i32","block",0,"x"], ["blkSeen","f64","block",0,"x"],
  ["secVent","f64","boiler",0,"x"], ["machSc","f64","machSc",0,"x"], ["wallTie","i32","paintM",0,"x"],
  ["annOn","u8","ann",0],
  // event ring: (code, tick, a, b)
  ["evCode","i32","ev",0], ["evTick","f64","ev",0], ["evA","f64","ev",0], ["evB","f64","ev",0],
  // room cells (GW*GH)
  ["roomT","f64","cell",T_HULL], ["roomH2","f32","cell",0], ["roomO2","f32","cell",ROOM_O2_0], ["roomFlame","f32","cell",0],
  ["roomP","f32","cell",0], ["roomPU","f32","cell",0], ["roomPV","f32","cell",0],
  ["roomPool","f64","cell",0], ["roomPoolE","f64","cell",0], ["roomPoolU","f32","cell",0], ["roomPoolV","f32","cell",0],
  ["roomWU","f32","cell",0], ["roomWV","f32","cell",0], ["roomWP","f32","cell",0], ["roomPoolP","f32","cell",0],
  ["roomWater","f64","cell",0], ["roomWaterE","f64","cell",0], ["roomM","f32","cell",ROOM_M0], ["roomVap","f32","cell",0],
  ["roomPPk","f32","cell",0], ["roomScar","f32","cell",0], ["roomScarCur","f32","cell",0],
  // per core
  ["csN","f64","core",0], ["csI","f64","core",0], ["csX","f64","core",0], ["csTf","f64","core",0],
  ["csDecay","f64","core",0], ["csHeat","f64","core",0], ["csRodPos","f64","core",0], ["csRodDem","f64","core",0],
  ["csRodJam","u8","core",0], ["csRodBand","u8","core",0], ["csScrammed","u8","core",0], ["csRpsNear","u8","core",0],
  ["csRpsHot","f64","core",0], ["csTrip","i32","core",0], ["csSplit","u8","core",0], ["csReGang","u8","core",0],
  ["csTilt","f64","core",0], ["csTiltDem","f64","core",0], ["csBreach","u8","core",0], ["csMelt","u8","core",0],
  ["csFatigue","f64","core",0], ["csDmg","f64","core",0], ["csMeltFrac","f64","core",0], ["csOxMax","f64","core",0],
  ["csQOx","f64","core",0], ["csFci","f64","core",0], ["csFq","f64","core",1],
  ["csDnbr","f64","core",0], ["csVf","f64","core",0], ["csVoidTh","f64","core",0], ["csRho","f64","core",0],
  ["csPCore","f64","core",0], ["csCoreDT","f64","core",0], ["csFlowNet","f64","core",1], ["csAo","f64","core",0],
  ["csRo","f64","core",0], ["csHotRing","f64","core",0], ["csHotLev","f64","core",0], ["csVNode","f64","core",0],
  ["csHotFlow","f64","core",1], ["csTipRho","f64","core",0], ["csTfHot","f64","core",0], ["csTcladHot","f64","core",0],
  ["csDnbrMin","f64","core",0], ["csDnbrRing","f64","core",0], ["csDnbrLev","f64","core",0],
  ["csTubesOpen","f64","core",0], ["csCavRelief","f64","core",0],
  ["csTripArg","i32","core",-1], ["csNOxI","f64","coreNode",0],
  ["coreFN","f64","core",0,"x"], ["coreMixK","f64","xnr",0,"x"], ["coreDisK","f64","xnn",0,"x"],
  ["coreO","f64","coreO",0,"x"], ["corePeak","f64","peak",0,"x"], ["coreStage","f64","fail",0,"x"],
  ["radCoreW","f64","core",0,"x"], ["radTankW","f64","tank",0,"x"], ["radMisc","f64","rad3",0,"x"],
  ["csParts","f64","coreRp",0], ["csC","f64","coreGrp",0], ["csDec","f64","coreDec",0],
  ["csChW","f64","coreRing",1],
  ["csRodZ","f64","coreBank",0], ["csRodZDem","f64","coreBank",0], ["csBankAuto","u8","coreBank",1],
  ["csPhi","f64","coreNode",1], ["csXI","f64","coreNode",0], ["csXX","f64","coreNode",0],
  ["csNTf","f64","coreNode",0], ["csNTc","f64","coreNode",0], ["csNV","f64","coreNode",0], ["csNRho","f64","coreNode",0],
  ["csNVt","f64","coreNode",0], ["csNTct","f64","coreNode",0], ["csNTube","f64","coreNode",0],
  ["csNCov","f64","coreNode",0], ["csNFol","f64","coreNode",0], ["csNDmg","f64","coreNode",0], ["csNOx","f64","coreNode",0],
  ["csNMelt","f64","coreNode",0], ["csNDisp","f64","coreNode",0], ["csNDnb","f64","coreNode",0],
  ["csNTg","f64","coreNode",0], ["csGQ","f64","core",0], ["csFQ","f64","core",0], ["csNFilm","f64","coreNode",0],
];
/* named mass books: kg out of the plant, cumulative; negative is a boundary feeding it */
const E_BK_ADVECT=0, E_BK_INJECT=1, E_BK_SUMP=2, E_BK_RELIEFROOM=3, E_BK_TANKWRECK=4, E_BK_BURSTDISC=5, E_BK_SPILLPRI=6,
      E_BK_BOUNDARYTANK=7, E_BK_SGVENT=8, E_BK_TANKCLAMPSEC=9, E_BK_SPILLSEC=10, E_BK_MELT=11, E_BK_N=12;
const E_BK_NAMES = ["advect","inject","sump","reliefRoom","tankWreck","burstDisc","spillPri","boundaryTank","sgVent","tankClampSec","spillSec","melt"];
/* shell levels are % of the downcomer span, SG_DOME the steam space above it */
const E_SGL_SET = 50, E_SG_DOME = 1.6, E_SG_DRY = 25, E_SG_DRY_LO = 10, E_SG_LOW = 35, E_SG_EFW_OFF = 40;
const E_CP_STEEL = 0.5, E_SETTLE_RELAX = 0.5;
/* the global NaN and Infinity are property loads that box a double when they meet one in a branch; these fold to constants */
const E_NAN = NaN, E_INF = Infinity;
const RP_ROD=0, RP_DOP=1, RP_MOD=2, RP_EXP=3, RP_XE=4, RP_BOR=5, RP_VD=6, RP_TIP=7, RP_DIS=8, RP_GR=9, RP_N=10;
const EV_N=256;
/* event codes: append a name, never reorder; EV_<NAME> is its index */
const EV_NAMES = ["NONE", "TUBE_RUPTURE", "SHIELD_LIFTED", "VESSEL_RUPTURE", "CORE_MELT", "SCRAM", "BANKS_SPLIT", "BANKS_GANGING",
  "HIPOW", "DNBR13", "DNBR10", "REACTOR_TRIP", "RECRIT", "CAVITATION", "LINE_DRY", "FLOW_FLOOR", "PRI_OVERP",
  "RELIEF_PASSING", "PORV_STUCK", "CORE_VOID", "HIRAD", "ROOM_HOT", "H2_ROOM", "XENON_PIT", "ROD_JAM", "RPS_OFF",
  "RUNBACK_OFF", "NO_RPS", "INJECTING", "FUEL_DMG1", "FUEL_DMG25", "WATCH_DOSE", "VESSEL_FATIGUE", "VESSEL_BREACH",
  "CLAD_OX", "H2_PRIMARY", "CORE_MELTED",
  "FLOODED", "EXPLOSION", "BLAST_DMG", "CRUSH_DMG", "SHELL_FAIL", "COOKED", "COOKED_CELL", "DEFLAGRATION",
  "NA_FIRE", "NA_FIRE_PEAK", "PARTY_OUT", "REPAIRED", "LEDGER",
  "SG_RELIEF_LIFT", "DISC_BURST", "VACUUM_LOST", "TURB_TRIP", "TURB_RESET", "COND_VENTING", "SG_BURST", "PIPE_BURST", "WALL_BURST"];
for(let i=0;i<EV_NAMES.length;i++) globalThis["EV_"+EV_NAMES[i]] = i;
