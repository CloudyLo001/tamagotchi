// Piezo-style beeper: every cue is synthesized square waves, no audio assets.

type Note = [freqHz: number, durMs: number, gapMs?: number];

export class Beeper {
  private ctx: AudioContext | null = null;
  enabled = true;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private playNotes(notes: Note[], volume = 0.12) {
    const ctx = this.ensure();
    if (!ctx) return;
    let t = ctx.currentTime + 0.01;
    for (const [freq, dur, gap] of notes) {
      if (freq > 0) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = freq;
        g.gain.setValueAtTime(volume, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur / 1000);
        osc.connect(g).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + dur / 1000 + 0.01);
      }
      t += (dur + (gap ?? 15)) / 1000;
    }
  }

  blip() { this.playNotes([[720, 40]]); }
  confirm() { this.playNotes([[880, 50], [1320, 70]]); }
  cancel() { this.playNotes([[520, 60]]); }
  refuse() { this.playNotes([[240, 90], [200, 120]]); }
  eat() { this.playNotes([[600, 45], [700, 45], [800, 60]]); }
  clean() { this.playNotes([[900, 40], [1100, 40], [1300, 60]]); }
  win() { this.playNotes([[880, 60], [1100, 60], [1470, 110]]); }
  lose() { this.playNotes([[400, 90], [300, 140]]); }
  attention() { this.playNotes([[1400, 90, 60], [1400, 90, 60], [1400, 140]], 0.14); }
  evolveJingle() {
    this.playNotes([[660, 90], [830, 90], [990, 90], [1320, 160], [990, 70], [1320, 240]], 0.13);
  }
  deathChime() {
    this.playNotes([[880, 180, 40], [660, 180, 40], [520, 200, 40], [392, 320]], 0.12);
  }
  hatch() { this.playNotes([[523, 70], [659, 70], [784, 70], [1046, 140]]); }
  sleepCue() { this.playNotes([[500, 90], [400, 140]]); }
}
