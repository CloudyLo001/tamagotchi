import { CATCHUP_CAP_MINUTES } from "./data";
import { PetSim, PetSnapshot, SimEvent, newPetSnapshot } from "./pet";

const SAVE_KEY = "tama3d.pet.v1";
const SETTINGS_KEY = "tama3d.settings.v1";

export type ShellId = "lightning" | "dream" | "candy";

export interface Settings {
  shell: ShellId;
  eggColor: "white" | "pink";
  sound: boolean;
  lcd: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  shell: "lightning",
  eggColor: "white",
  sound: true,
  lcd: true,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

interface StoredSave {
  snapshot: PetSnapshot;
  wallClockMs: number;
}

export function loadPetSave(): StoredSave | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSave;
    if (parsed?.snapshot?.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePet(sim: PetSim) {
  const stored: StoredSave = { snapshot: sim.s, wallClockMs: Date.now() };
  localStorage.setItem(SAVE_KEY, JSON.stringify(stored));
}

export function clearPetSave() {
  localStorage.removeItem(SAVE_KEY);
}

export function newPet(eggColor: "white" | "pink"): PetSim {
  return new PetSim(newPetSnapshot(eggColor, (Math.random() * 0xffffffff) >>> 0));
}

export interface CatchUpResult {
  sim: PetSim;
  elapsedGameMin: number;
  /** Condensed things that happened while away, for a "welcome back" note. */
  highlights: SimEvent[];
}

/**
 * Rebuild the sim from a stored save and fast-forward it through the real time
 * that passed while the page was closed. 1 real second = 1 game minute; capped
 * so an abandoned tab does not spin forever (two game weeks is far beyond every
 * death condition anyway).
 */
export function resumePet(stored: StoredSave): CatchUpResult {
  const sim = new PetSim(stored.snapshot);
  const elapsedMs = Math.max(0, Date.now() - stored.wallClockMs);
  let minutes = Math.floor(elapsedMs / 1000);
  if (minutes > CATCHUP_CAP_MINUTES) minutes = CATCHUP_CAP_MINUTES;

  const highlights: SimEvent[] = [];
  for (let i = 0; i < minutes; i++) {
    const events = sim.tick();
    for (const e of events) {
      if (
        e.kind === "died" ||
        e.kind === "evolved" ||
        e.kind === "hatched" ||
        e.kind === "gotSick" ||
        e.kind === "careMistake"
      ) {
        highlights.push(e);
      }
    }
    if (sim.s.stage === "dead") break;
  }
  return { sim, elapsedGameMin: minutes, highlights };
}
