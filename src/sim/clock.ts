import { PetSim, SimEvent } from "./pet";

/**
 * Fixed-timestep driver: converts real elapsed milliseconds into whole
 * game-minute ticks (1 real second each), independent of render framerate.
 */
export class SimClock {
  private accumulatorMs = 0;
  /** Real ms per game minute. */
  readonly stepMs = 1000;

  advance(sim: PetSim, deltaMs: number): SimEvent[] {
    this.accumulatorMs += deltaMs;
    const events: SimEvent[] = [];
    // Guard: a backgrounded tab can hand us a huge delta; process at most a
    // burst then let resumePet-style catch-up handle true absences.
    let safety = 4000;
    while (this.accumulatorMs >= this.stepMs && safety-- > 0) {
      this.accumulatorMs -= this.stepMs;
      events.push(...sim.tick());
      if (sim.s.stage === "dead") break;
    }
    return events;
  }
}
