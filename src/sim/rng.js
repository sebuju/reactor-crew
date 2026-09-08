/* mulberry32; Math.imul throughout so the sequence is bit-identical across engines. */
function seedRng(s,seed){
  s.seed = seed>>>0;
  s.rng  = seed>>>0;
}
function srand(s){
  s.rng = (s.rng + 0x6D2B79F5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t>>>15), t | 1);
  t ^= t + Math.imul(t ^ (t>>>7), t | 61);
  return ((t ^ (t>>>14)) >>> 0) / 4294967296;
}

/* `p:null` = not a yes/no die: it decides which target, not whether. */
const DICE={
  porvStick:{p:0.18, act:"porvArm",
    what:"the relief valve fails to reseat after an automatic lift"},
  hitTarget:{p:null, act:"hit",
    what:"which component a combat hit destroys - weighted toward the hull"},
  burstCell:{p:null, act:"hit",
    what:"which cell of an overpressured run splits open"},
  /* Rolled over the argmin set: a wall's weakest cell is very often several. */
  wallCell:{p:null, act:"hit",
    what:"which of the equally weakest cells of an overpressured wall lets go"}
};
const roll=(s,k)=> !s.diceOff && srand(s) < DICE[k].p;
