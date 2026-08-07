// Small persistable PRNG (mulberry32) so offline catch-up replays are stable
// for a given save.

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;
  private draws = 0;

  constructor(public seed: number, draws = 0) {
    this.next = mulberry32(seed);
    for (let i = 0; i < draws; i++) this.next();
    this.draws = draws;
  }

  float(): number {
    this.draws++;
    return this.next();
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.float() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.float() < p;
  }

  get state() {
    return { seed: this.seed, draws: this.draws };
  }
}
