// "Left or Right": guess which way the pet turns. 5 rounds, 3+ wins = success.

export interface MiniGameState {
  round: number; // 1..5
  wins: number;
  phase: "prompt" | "reveal" | "done";
  petDir: -1 | 1;
  guess: -1 | 1 | null;
  lastWin: boolean | null;
  revealT: number;
  won: boolean;
}

export function newMiniGame(): MiniGameState {
  return {
    round: 1,
    wins: 0,
    phase: "prompt",
    petDir: Math.random() < 0.5 ? -1 : 1,
    guess: null,
    lastWin: null,
    revealT: 0,
    won: false,
  };
}

export function guess(state: MiniGameState, dir: -1 | 1) {
  if (state.phase !== "prompt") return;
  state.guess = dir;
  state.lastWin = dir === state.petDir;
  if (state.lastWin) state.wins++;
  state.phase = "reveal";
  state.revealT = 0;
}

/** Advance reveal timer; returns true the moment the game finishes. */
export function updateMiniGame(state: MiniGameState, dtSec: number): boolean {
  if (state.phase !== "reveal") return false;
  state.revealT += dtSec;
  if (state.revealT < 1.15) return false;
  if (state.round >= 5) {
    state.phase = "done";
    state.won = state.wins >= 3;
    return true;
  }
  state.round++;
  state.phase = "prompt";
  state.petDir = Math.random() < 0.5 ? -1 : 1;
  state.guess = null;
  state.lastWin = null;
  return false;
}
