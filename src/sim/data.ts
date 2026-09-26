// All Gen 1 tuning lives here — stage timings, decay rates, and the evolution
// chart are data tables, not code branches.

export type StageId = "egg" | "baby" | "child" | "teen" | "adult" | "dead";

export type CharacterId =
  | "egg"
  | "babytchi"
  | "marutchi"
  | "tamatchi"
  | "kuchitamatchi"
  | "mametchi"
  | "ginjirotchi"
  | "maskutchi"
  | "kuchipatchi"
  | "nyorotchi"
  | "tarakotchi"
  | "oyajitchi";

export interface CharacterDef {
  id: CharacterId;
  name: string;
  stage: StageId;
  /** Logical asset key inside the mint character pack. */
  assetKey: string;
  /** Placeholder blob look when the generated model is unavailable. */
  fallbackColor: number;
  fallbackShape: "sphere" | "bean" | "tall" | "snake";
  /** Model display height inside the screen scene, world units. */
  height: number;
  /**
   * Outfit anchors, as fractions of `height` measured from the feet. Defaults
   * suit round blobs; override for unusual faces (long, small, off-centre).
   */
  eyeY?: number;
  neckY?: number;
  /** How far below the crown to measure head width (default 0.14). Small
   *  heads on thin necks need a shallower cut or the neck gets measured. */
  headDrop?: number;
}

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  egg:           { id: "egg",           name: "Egg",           stage: "egg",   assetKey: "egg",          fallbackColor: 0xffffff, fallbackShape: "sphere", height: 1.0 },
  babytchi:      { id: "babytchi",      name: "Babytchi",      stage: "baby",  assetKey: "baby",         fallbackColor: 0x333340, fallbackShape: "sphere", height: 0.55, eyeY: 0.5, neckY: 0.2 },
  marutchi:      { id: "marutchi",      name: "Marutchi",      stage: "child", assetKey: "child",        fallbackColor: 0xf5f2ea, fallbackShape: "sphere", height: 0.8, eyeY: 0.42, neckY: 0.2, headDrop: 0.32 },
  tamatchi:      { id: "tamatchi",      name: "Tamatchi",      stage: "teen",  assetKey: "teen-good",    fallbackColor: 0xfff3d6, fallbackShape: "bean",   height: 1.0 },
  kuchitamatchi: { id: "kuchitamatchi", name: "Kuchitamatchi", stage: "teen",  assetKey: "teen-bad",     fallbackColor: 0xf7d648, fallbackShape: "bean",   height: 1.0, eyeY: 0.7 },
  mametchi:      { id: "mametchi",      name: "Mametchi",      stage: "adult", assetKey: "adult-mame",   fallbackColor: 0xffd23b, fallbackShape: "sphere", height: 1.15 },
  ginjirotchi:   { id: "ginjirotchi",   name: "Ginjirotchi",   stage: "adult", assetKey: "adult-ginji",  fallbackColor: 0x4fc8b0, fallbackShape: "bean",   height: 1.15, eyeY: 0.72 },
  maskutchi:     { id: "maskutchi",     name: "Maskutchi",     stage: "adult", assetKey: "adult-masku",  fallbackColor: 0xb69ae0, fallbackShape: "sphere", height: 1.1, eyeY: 0.7 },
  kuchipatchi:   { id: "kuchipatchi",   name: "Kuchipatchi",   stage: "adult", assetKey: "adult-kuchipa", fallbackColor: 0x9bd76a, fallbackShape: "bean",  height: 1.15, eyeY: 0.74 },
  // Tall characters are capped so they stay inside the LCD framing.
  nyorotchi:     { id: "nyorotchi",     name: "Nyorotchi",     stage: "adult", assetKey: "adult-nyoro",  fallbackColor: 0xf09a3e, fallbackShape: "snake",  height: 1.1, eyeY: 0.87, neckY: 0.78, headDrop: 0.05 },
  tarakotchi:    { id: "tarakotchi",    name: "Tarakotchi",    stage: "adult", assetKey: "adult-tarako", fallbackColor: 0xf2c4c4, fallbackShape: "tall",   height: 1.15, neckY: 0.2 },
  oyajitchi:     { id: "oyajitchi",     name: "Oyajitchi",     stage: "adult", assetKey: "adult-secret", fallbackColor: 0xf5c39a, fallbackShape: "sphere", height: 0.95 },
};

export const PROP_ASSET_KEYS = {
  poop: "prop-poop",
  bread: "prop-bread",
  candy: "prop-candy",
  skull: "prop-skull",
  tombstone: "prop-tombstone",
} as const;

// ---------------------------------------------------------------------------
// Time. 1 real minute = 1 game hour  =>  1 real second = 1 game minute.
// ---------------------------------------------------------------------------

export const GAME_MIN_PER_REAL_MS = 1 / 1000; // one game minute per real second
export const DAY_MINUTES = 24 * 60;
export const WAKE_MINUTE = 9 * 60; // 09:00
export const SLEEP_MINUTE = 21 * 60; // 21:00
export const START_MINUTE_OF_DAY = 10 * 60; // new eggs begin at 10:00

// Offline catch-up cap: two weeks of game days (in game minutes).
export const CATCHUP_CAP_MINUTES = 14 * DAY_MINUTES;

// ---------------------------------------------------------------------------
// Stage tuning
// ---------------------------------------------------------------------------

export interface StageTuning {
  /** Game minutes between losing one hungry heart. */
  hungryDecayMin: number;
  /** Game minutes between losing one happy heart. */
  happyDecayMin: number;
  /** Minimum weight in lb. */
  minWeight: number;
  /** Weight at/above this makes the pet sulk. */
  chubbyWeight: number;
}

export const STAGE_TUNING: Record<Exclude<StageId, "egg" | "dead">, StageTuning> = {
  baby:  { hungryDecayMin: 12, happyDecayMin: 14, minWeight: 5,  chubbyWeight: 15 },
  child: { hungryDecayMin: 55, happyDecayMin: 65, minWeight: 10, chubbyWeight: 30 },
  teen:  { hungryDecayMin: 70, happyDecayMin: 80, minWeight: 20, chubbyWeight: 45 },
  adult: { hungryDecayMin: 85, happyDecayMin: 95, minWeight: 30, chubbyWeight: 60 },
};

export const TIMINGS = {
  eggHatchMin: 5, // egg wobbles for 5 game minutes (~5 real seconds)
  babyToChildMin: 60, // baby stage lasts one game hour
  childToTeenAge: 2, // in game days ( = Tamagotchi years)
  teenToAdultAgeMin: 4,
  teenToAdultAgeMax: 5,
  oldAgeMin: 10,
  oldAgeMax: 14,
  oyajitchiAge: 10,
  oyajitchiBonusYears: 4,

  attentionWindowMin: 15, // ignored call becomes a care mistake after this
  disciplineWindowMin: 15,

  poopAfterMealMinMin: 30,
  poopAfterMealMaxMin: 90,
  poopBaselineMin: 240, // even without meals the pet poops every ~4h
  poopSickCount: 4,

  disciplineCallMinGapMin: 150,
  disciplineCallMaxGapMin: 420,

  sickDeathMin: 12 * 60, // untreated sickness for 12 game hours kills
  neglectDeathMin: 12 * 60, // both meters empty for 12 game hours kills
  snackSickThreshold: 4, // snacks per day beyond which sickness can strike
  snackSickChance: 0.35,
  secondDoseChance: 0.4, // medicine sometimes needs 2 doses
} as const;

// ---------------------------------------------------------------------------
// Evolution chart (Gen 1). Rows are evaluated top to bottom; first match wins.
// ---------------------------------------------------------------------------

export interface TeenRule {
  to: CharacterId;
  maxChildCareMistakes: number | null; // null = catch-all
}

export const TEEN_CHART: TeenRule[] = [
  { to: "tamatchi", maxChildCareMistakes: 2 },
  { to: "kuchitamatchi", maxChildCareMistakes: null },
];

export interface AdultRule {
  to: CharacterId;
  fromTeen: CharacterId | null; // null = either teen
  careMistakes: [number, number]; // inclusive range, Infinity allowed
  disciplineMistakes: [number, number];
  requireFullDiscipline?: boolean; // discipline meter must be 100%
}

const INF = Number.POSITIVE_INFINITY;

export const ADULT_CHART: AdultRule[] = [
  { to: "mametchi",    fromTeen: "tamatchi", careMistakes: [0, 2],   disciplineMistakes: [0, 0], requireFullDiscipline: true },
  { to: "ginjirotchi", fromTeen: "tamatchi", careMistakes: [0, 2],   disciplineMistakes: [1, 1] },
  { to: "maskutchi",   fromTeen: "tamatchi", careMistakes: [0, 2],   disciplineMistakes: [2, INF] },
  { to: "kuchipatchi", fromTeen: null,       careMistakes: [3, INF], disciplineMistakes: [0, 1] },
  { to: "nyorotchi",   fromTeen: null,       careMistakes: [3, INF], disciplineMistakes: [2, 3] },
  { to: "tarakotchi",  fromTeen: null,       careMistakes: [3, INF], disciplineMistakes: [4, INF] },
  // Catch-alls so every combination lands somewhere sensible.
  { to: "ginjirotchi", fromTeen: "tamatchi", careMistakes: [0, INF], disciplineMistakes: [0, INF] },
  { to: "kuchipatchi", fromTeen: null,       careMistakes: [0, INF], disciplineMistakes: [0, INF] },
];
