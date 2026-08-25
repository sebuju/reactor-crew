/* ══ THE SIM ROLLS NO LOOSE DICE ══
   Every random outcome the plant can produce comes out of ONE generator whose
   cursor lives on S. Nothing in the sim may call Math.random(): a loose call
   reads a number that is not in the state, so a recording replayed from a
   snapshot diverges from the run it recorded and there is no way to tell which
   of the two was the real plant. The seed is drawn once, in resetPlant(),
   outside the tick - so free play still rolls, and a free-play run also
   replays exactly, which is a bonus that falls out rather than a feature.

   THE RULE THIS FILE EXISTS TO ENFORCE: any random outcome the sim can produce
   must ALSO be an authorable scenario event. DICE below is the one table of
   them, in the spirit of AUTOSYS in step.js - each row says what the die
   decides, the odds it decides on in free play, and the ACT a scenario uses to
   command the outcome instead of rolling for it. A row with no `act` is a row
   that cannot be authored: a fault a lesson can never stage on purpose, which
   is exactly the thing a scripted drill needs most. Add the act with the die,
   never after.

   mulberry32, and it is Math.imul throughout on purpose. Written with plain `*`
   the multiply goes through a double and loses the low bits above 2^53, so two
   engines - or the same engine on a different day - can disagree about a
   sequence that is supposed to BE the recording. imul is exact in 32 bits and
   bit-identical everywhere. */
function seedRng(s,seed){
  s.seed = seed>>>0;                  // what the recording stores
  s.rng  = seed>>>0;                  // where the cursor stands now
}
function srand(s){
  s.rng = (s.rng + 0x6D2B79F5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t>>>15), t | 1);
  t ^= t + Math.imul(t ^ (t>>>7), t | 61);
  return ((t ^ (t>>>14)) >>> 0) / 4294967296;
}

/* One row per die. `p` is the free-play probability; `act` is the field a
   scenario writes to command the outcome instead; `what` is what the die is
   actually deciding, in the words the event log would use.
   `p:null` is a die that is not a yes/no at all - the combat target is a
   weighted pick over the layout, so there is no single probability to quote,
   but it still owes an act, because "hit the pressurizer" is the single most
   obvious thing a drill wants to stage. */
const DICE={
  porvStick:{p:0.18, act:"porvArm",
    what:"the relief valve fails to reseat after an automatic lift"},
  hitTarget:{p:null, act:"hit",
    what:"which component a combat hit destroys - weighted toward the hull"}
};
/* s.diceOff is the scenario's master switch: nothing rolls, so the only faults
   that happen are the ones the script asked for. It is on S rather than a
   module flag because it has to travel in a snapshot with everything else. */
const roll=(s,k)=> !s.diceOff && srand(s) < DICE[k].p;
