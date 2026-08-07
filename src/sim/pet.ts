import {
  ADULT_CHART,
  CHARACTERS,
  CharacterId,
  DAY_MINUTES,
  SLEEP_MINUTE,
  STAGE_TUNING,
  START_MINUTE_OF_DAY,
  StageId,
  TEEN_CHART,
  TIMINGS,
  WAKE_MINUTE,
} from "./data";
import { Rng } from "./rng";

export type AttentionType = "hungry" | "happy" | "sleep" | "discipline";

export interface AttentionCall {
  type: AttentionType;
  /** Absolute game minute the call started. */
  atMin: number;
  /** Absolute game minute at which ignoring it becomes a mistake. */
  deadlineMin: number;
}

export type DeathCause = "oldAge" | "sickness" | "neglect";

export interface PetSnapshot {
  version: 1;
  // clocks
  totalMin: number; // absolute game minutes since this egg was started
  minuteOfDay: number;
  ageDays: number;
  // identity
  stage: StageId;
  character: CharacterId;
  teenCharacter: CharacterId | null;
  eggColor: "white" | "pink";
  // meters
  hungry: number;
  happy: number;
  weight: number;
  discipline: number; // 0..100
  // mistake counters
  careMistakesChild: number;
  careMistakesTotal: number; // child + teen (drives adult evolution)
  careMistakesAdult: number;
  disciplineMistakes: number;
  everDisciplined: boolean;
  // timers
  stageStartMin: number;
  hungryTimer: number;
  happyTimer: number;
  neglectTimer: number;
  adultAtAge: number;
  deathAtAge: number;
  // world
  poops: number;
  nextPoopAtMin: number;
  nextDisciplineCallAtMin: number;
  snacksToday: number;
  sick: boolean;
  sickSinceMin: number;
  medicineDosesNeeded: number;
  medicineDosesGiven: number;
  asleep: boolean;
  lightsOn: boolean;
  sleepMistakeArmed: boolean; // lights-on-at-bedtime call already handled tonight?
  attention: AttentionCall | null;
  /** After an ignored call, the pet sulks and stops calling until this time. */
  attentionCooldownUntilMin: number;
  deathCause: DeathCause | null;
  rngSeed: number;
  rngDraws: number;
}

export type SimEvent =
  | { kind: "hatched" }
  | { kind: "evolved"; to: CharacterId }
  | { kind: "died"; cause: DeathCause }
  | { kind: "attention"; type: AttentionType }
  | { kind: "attentionCleared" }
  | { kind: "careMistake" }
  | { kind: "disciplineMistake" }
  | { kind: "pooped" }
  | { kind: "gotSick" }
  | { kind: "cured" }
  | { kind: "fellAsleep" }
  | { kind: "wokeUp" }
  | { kind: "refusedFood" }
  | { kind: "ate"; snack: boolean }
  | { kind: "birthday"; age: number };

export function newPetSnapshot(eggColor: "white" | "pink", seed: number): PetSnapshot {
  return {
    version: 1,
    totalMin: 0,
    minuteOfDay: START_MINUTE_OF_DAY,
    ageDays: 0,
    stage: "egg",
    character: "egg",
    teenCharacter: null,
    eggColor,
    hungry: 4,
    happy: 4,
    weight: 5,
    discipline: 0,
    careMistakesChild: 0,
    careMistakesTotal: 0,
    careMistakesAdult: 0,
    disciplineMistakes: 0,
    everDisciplined: false,
    stageStartMin: 0,
    hungryTimer: 0,
    happyTimer: 0,
    neglectTimer: 0,
    adultAtAge: 0,
    deathAtAge: 0,
    poops: 0,
    nextPoopAtMin: -1,
    nextDisciplineCallAtMin: -1,
    snacksToday: 0,
    sick: false,
    sickSinceMin: 0,
    medicineDosesNeeded: 1,
    medicineDosesGiven: 0,
    asleep: false,
    lightsOn: true,
    sleepMistakeArmed: false,
    attention: null,
    attentionCooldownUntilMin: 0,
    deathCause: null,
    rngSeed: seed,
    rngDraws: 0,
  };
}

/**
 * The full Gen 1 state machine. tick() advances exactly one game minute and
 * returns the events that happened, so the presentation layer can react
 * (or ignore them entirely during offline fast-forward).
 */
export class PetSim {
  s: PetSnapshot;
  private rng: Rng;

  constructor(snapshot: PetSnapshot) {
    this.s = snapshot;
    this.rng = new Rng(snapshot.rngSeed, snapshot.rngDraws);
  }

  private syncRng() {
    const st = this.rng.state;
    this.s.rngSeed = st.seed;
    this.s.rngDraws = st.draws;
  }

  get isAwake() {
    return !this.s.asleep && this.s.stage !== "egg" && this.s.stage !== "dead";
  }

  get isChubby() {
    const t = this.tuning();
    return t !== null && this.s.weight >= t.chubbyWeight;
  }

  private tuning() {
    const st = this.s.stage;
    if (st === "egg" || st === "dead") return null;
    return STAGE_TUNING[st];
  }

  // ------------------------------------------------------------------ tick

  tick(): SimEvent[] {
    const s = this.s;
    const ev: SimEvent[] = [];
    if (s.stage === "dead") return ev;

    s.totalMin++;
    s.minuteOfDay++;
    if (s.minuteOfDay >= DAY_MINUTES) {
      s.minuteOfDay = 0;
    }
    if (s.minuteOfDay === WAKE_MINUTE) {
      // A Tamagotchi year passes each time the pet wakes up.
      if (s.stage !== "egg") {
        s.ageDays++;
        ev.push({ kind: "birthday", age: s.ageDays });
      }
      s.snacksToday = 0;
    }

    this.updateSleep(ev);

    switch (s.stage) {
      case "egg":
        if (s.totalMin - s.stageStartMin >= TIMINGS.eggHatchMin) {
          this.becomeCharacter("babytchi", ev);
          ev.push({ kind: "hatched" });
        }
        break;
      case "baby":
      case "child":
      case "teen":
      case "adult":
        this.tickAlive(ev);
        break;
    }

    this.syncRng();
    return ev;
  }

  private updateSleep(ev: SimEvent[]) {
    const s = this.s;
    if (s.stage === "egg" || s.stage === "dead") return;
    const shouldSleep = s.minuteOfDay >= SLEEP_MINUTE || s.minuteOfDay < WAKE_MINUTE;

    if (shouldSleep && !s.asleep) {
      s.asleep = true;
      s.sleepMistakeArmed = true;
      ev.push({ kind: "fellAsleep" });
      if (s.lightsOn) {
        this.raiseAttention("sleep", ev);
      }
    } else if (!shouldSleep && s.asleep) {
      s.asleep = false;
      s.lightsOn = true;
      s.sleepMistakeArmed = false;
      if (s.attention?.type === "sleep") this.clearAttention(ev);
      ev.push({ kind: "wokeUp" });
    }

    // Lights turned off while asleep resolves the bedtime call.
    if (s.asleep && !s.lightsOn && s.attention?.type === "sleep") {
      this.clearAttention(ev);
    }
  }

  private tickAlive(ev: SimEvent[]) {
    const s = this.s;
    const t = this.tuning()!;

    if (this.isAwake) {
      // Heart decay
      s.hungryTimer++;
      s.happyTimer++;
      // A chubby pet sulks: happiness drains faster.
      const happyInterval = this.isChubby ? Math.floor(t.happyDecayMin * 0.6) : t.happyDecayMin;
      if (s.hungryTimer >= t.hungryDecayMin) {
        s.hungryTimer = 0;
        if (s.hungry > 0) s.hungry--;
        if (s.hungry === 0) this.raiseNeedAttention("hungry", ev);
      }
      if (s.happyTimer >= happyInterval) {
        s.happyTimer = 0;
        if (s.happy > 0) s.happy--;
        if (s.happy === 0) this.raiseNeedAttention("happy", ev);
      }

      // Poop schedule
      if (s.nextPoopAtMin < 0) {
        s.nextPoopAtMin = s.totalMin + TIMINGS.poopBaselineMin + this.rng.int(-60, 60);
      }
      if (s.totalMin >= s.nextPoopAtMin) {
        s.nextPoopAtMin = s.totalMin + TIMINGS.poopBaselineMin + this.rng.int(-60, 60);
        s.poops = Math.min(s.poops + 1, 4);
        ev.push({ kind: "pooped" });
        if (s.poops >= TIMINGS.poopSickCount && !s.sick) this.makeSick(ev);
      }

      // Discipline calls: pet wants "nothing" while both meters are non-empty.
      if (s.stage !== "baby") {
        if (s.nextDisciplineCallAtMin < 0) {
          s.nextDisciplineCallAtMin =
            s.totalMin + this.rng.int(TIMINGS.disciplineCallMinGapMin, TIMINGS.disciplineCallMaxGapMin);
        }
        if (
          s.totalMin >= s.nextDisciplineCallAtMin &&
          !s.attention &&
          s.hungry > 0 &&
          s.happy > 0 &&
          !s.sick
        ) {
          s.nextDisciplineCallAtMin =
            s.totalMin + this.rng.int(TIMINGS.disciplineCallMinGapMin, TIMINGS.disciplineCallMaxGapMin);
          this.raiseAttention("discipline", ev);
        }
      }
    }

    // Attention deadlines run day and night (bedtime call included).
    if (s.attention && s.totalMin >= s.attention.deadlineMin) {
      const type = s.attention.type;
      s.attention = null;
      ev.push({ kind: "attentionCleared" });
      // The ignored pet sulks quietly for a while before calling again.
      s.attentionCooldownUntilMin = s.totalMin + 30;
      if (type === "discipline") {
        s.disciplineMistakes++;
        ev.push({ kind: "disciplineMistake" });
      } else {
        this.addCareMistake(ev);
      }
    }

    // Re-raise hunger/happy calls if a meter is still empty and nothing pends.
    if (this.isAwake && !s.attention) {
      if (s.hungry === 0) this.raiseNeedAttention("hungry", ev);
      else if (s.happy === 0) this.raiseNeedAttention("happy", ev);
    }

    // Sickness clock
    if (s.sick && s.totalMin - s.sickSinceMin >= TIMINGS.sickDeathMin) {
      this.die("sickness", ev);
      return;
    }

    // Neglect clock
    if (s.hungry === 0 && s.happy === 0) {
      s.neglectTimer++;
      if (s.neglectTimer >= TIMINGS.neglectDeathMin) {
        this.die("neglect", ev);
        return;
      }
    } else {
      s.neglectTimer = 0;
    }

    this.checkGrowth(ev);
  }

  // ------------------------------------------------------------- attention

  /** Hungry/happy calls respect the post-ignore cooldown. */
  private raiseNeedAttention(type: "hungry" | "happy", ev: SimEvent[]) {
    if (this.s.totalMin < this.s.attentionCooldownUntilMin) return;
    this.raiseAttention(type, ev);
  }

  private raiseAttention(type: AttentionType, ev: SimEvent[]) {
    const s = this.s;
    if (s.attention) return;
    const window = type === "discipline" ? TIMINGS.disciplineWindowMin : TIMINGS.attentionWindowMin;
    s.attention = { type, atMin: s.totalMin, deadlineMin: s.totalMin + window };
    ev.push({ kind: "attention", type });
  }

  private clearAttention(ev: SimEvent[]) {
    if (!this.s.attention) return;
    this.s.attention = null;
    ev.push({ kind: "attentionCleared" });
  }

  private addCareMistake(ev: SimEvent[]) {
    const s = this.s;
    if (s.stage === "child" || s.stage === "baby") s.careMistakesChild++;
    if (s.stage === "adult") s.careMistakesAdult++;
    else s.careMistakesTotal++;
    ev.push({ kind: "careMistake" });
  }

  // ------------------------------------------------------------ life cycle

  private becomeCharacter(id: CharacterId, ev: SimEvent[]) {
    const s = this.s;
    const def = CHARACTERS[id];
    s.character = id;
    s.stage = def.stage;
    s.stageStartMin = s.totalMin;
    const t = this.tuning();
    if (t) s.weight = Math.max(s.weight, t.minWeight);
    if (id !== "babytchi") ev.push({ kind: "evolved", to: id });

    if (def.stage === "teen") {
      s.adultAtAge = this.rng.int(TIMINGS.teenToAdultAgeMin, TIMINGS.teenToAdultAgeMax);
    }
    if (def.stage === "adult") {
      s.deathAtAge = this.rng.int(TIMINGS.oldAgeMin, TIMINGS.oldAgeMax);
    }
  }

  private checkGrowth(ev: SimEvent[]) {
    const s = this.s;
    // Evolution only happens while awake.
    if (!this.isAwake) return;

    switch (s.stage) {
      case "baby":
        if (s.totalMin - s.stageStartMin >= TIMINGS.babyToChildMin) {
          this.becomeCharacter("marutchi", ev);
        }
        break;
      case "child":
        if (s.ageDays >= TIMINGS.childToTeenAge) {
          const rule = TEEN_CHART.find(
            (r) => r.maxChildCareMistakes === null || s.careMistakesChild <= r.maxChildCareMistakes,
          )!;
          s.teenCharacter = rule.to;
          this.becomeCharacter(rule.to, ev);
        }
        break;
      case "teen":
        if (s.ageDays >= s.adultAtAge) {
          const cm = s.careMistakesTotal;
          const dm = s.disciplineMistakes;
          const rule = ADULT_CHART.find((r) => {
            if (r.fromTeen && r.fromTeen !== s.teenCharacter) return false;
            if (cm < r.careMistakes[0] || cm > r.careMistakes[1]) return false;
            if (dm < r.disciplineMistakes[0] || dm > r.disciplineMistakes[1]) return false;
            if (r.requireFullDiscipline && s.discipline < 100) return false;
            return true;
          })!;
          this.becomeCharacter(rule.to, ev);
        }
        break;
      case "adult":
        // Secret character: Maskutchi, never disciplined, flawless adult care.
        if (
          s.character === "maskutchi" &&
          !s.everDisciplined &&
          s.careMistakesAdult === 0 &&
          s.ageDays >= TIMINGS.oyajitchiAge
        ) {
          this.becomeCharacter("oyajitchi", ev);
          s.deathAtAge = TIMINGS.oyajitchiAge + TIMINGS.oyajitchiBonusYears + this.rng.int(0, 3);
          break;
        }
        if (s.ageDays >= s.deathAtAge) {
          this.die("oldAge", ev);
        }
        break;
    }
  }

  private makeSick(ev: SimEvent[]) {
    const s = this.s;
    if (s.sick) return;
    s.sick = true;
    s.sickSinceMin = s.totalMin;
    s.medicineDosesNeeded = this.rng.chance(TIMINGS.secondDoseChance) ? 2 : 1;
    s.medicineDosesGiven = 0;
    ev.push({ kind: "gotSick" });
  }

  private die(cause: DeathCause, ev: SimEvent[]) {
    const s = this.s;
    s.stage = "dead";
    s.deathCause = cause;
    s.attention = null;
    ev.push({ kind: "died", cause });
  }

  // ------------------------------------------------------------- commands
  // These are invoked by the icon menu. They return events for feedback.

  feedMeal(): SimEvent[] {
    const ev: SimEvent[] = [];
    const s = this.s;
    if (!this.isAwake || s.sick) return ev;
    if (s.hungry >= 4) {
      ev.push({ kind: "refusedFood" });
      return ev;
    }
    s.hungry = Math.min(4, s.hungry + 1);
    s.weight += 1;
    s.nextPoopAtMin = s.totalMin + this.rng.int(TIMINGS.poopAfterMealMinMin, TIMINGS.poopAfterMealMaxMin);
    this.resolveNeedAttention(ev);
    ev.push({ kind: "ate", snack: false });
    this.syncRng();
    return ev;
  }

  feedSnack(): SimEvent[] {
    const ev: SimEvent[] = [];
    const s = this.s;
    if (!this.isAwake || s.sick) return ev;
    s.happy = Math.min(4, s.happy + 1);
    s.weight += 2;
    s.snacksToday++;
    // Sugar crash: too many snacks in one day can make a young pet sick — and
    // a sick child/teen that goes untreated will die.
    if (
      s.snacksToday > TIMINGS.snackSickThreshold &&
      !s.sick &&
      this.rng.chance(TIMINGS.snackSickChance)
    ) {
      this.makeSick(ev);
    }
    this.resolveNeedAttention(ev);
    ev.push({ kind: "ate", snack: true });
    this.syncRng();
    return ev;
  }

  /** Feeding or playing during a discipline call is the wrong answer. */
  private resolveNeedAttention(ev: SimEvent[]) {
    const s = this.s;
    if (!s.attention) return;
    if (s.attention.type === "discipline") {
      s.attention = null;
      s.disciplineMistakes++;
      ev.push({ kind: "attentionCleared" });
      ev.push({ kind: "disciplineMistake" });
    } else if (
      (s.attention.type === "hungry" && s.hungry > 0) ||
      (s.attention.type === "happy" && s.happy > 0)
    ) {
      this.clearAttention(ev);
    }
  }

  toggleLight(): SimEvent[] {
    const ev: SimEvent[] = [];
    this.s.lightsOn = !this.s.lightsOn;
    if (this.s.asleep && !this.s.lightsOn && this.s.attention?.type === "sleep") {
      this.clearAttention(ev);
    }
    return ev;
  }

  /** Mini-game finished. Win: +1 happy, −1 lb. */
  finishGame(won: boolean): SimEvent[] {
    const ev: SimEvent[] = [];
    const s = this.s;
    const t = this.tuning();
    if (won) {
      s.happy = Math.min(4, s.happy + 1);
      if (t) s.weight = Math.max(t.minWeight, s.weight - 1);
    }
    this.resolveNeedAttention(ev);
    this.syncRng();
    return ev;
  }

  giveMedicine(): SimEvent[] {
    const ev: SimEvent[] = [];
    const s = this.s;
    if (!s.sick) return ev;
    s.medicineDosesGiven++;
    if (s.medicineDosesGiven >= s.medicineDosesNeeded) {
      s.sick = false;
      s.medicineDosesGiven = 0;
      ev.push({ kind: "cured" });
    }
    return ev;
  }

  cleanToilet(): SimEvent[] {
    this.s.poops = 0;
    return [];
  }

  discipline(): SimEvent[] {
    const ev: SimEvent[] = [];
    const s = this.s;
    s.everDisciplined = true;
    if (s.attention?.type === "discipline") {
      s.discipline = Math.min(100, s.discipline + 25);
      this.clearAttention(ev);
    }
    return ev;
  }

  gameAllowed(): boolean {
    return this.isAwake && !this.s.sick && this.s.stage !== "egg";
  }
}
