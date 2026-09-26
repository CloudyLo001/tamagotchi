/**
 * Turns pointer movement over the Charm's screen into gestures. Coordinates
 * are screen UV (0..1, v up); speeds are screen widths per second.
 *
 * - tap:        press and release on the mascot without really moving
 * - double tap: two taps close together (a single tap waits briefly to see
 *               whether a second one follows)
 * - hold:       press on the mascot and keep still
 * - flick:      quick release while moving, anywhere on the screen; soft or
 *               hard by speed
 * - pet:        rub back and forth over the mascot (repeated direction
 *               changes)
 * - circle:     press on the mascot and draw circles; reported continuously
 *               as signed turns per second (+ = anticlockwise on screen)
 *
 * A slow drag does nothing: the mascot can't be turned by hand.
 */

export interface GestureHandlers {
  tap(): void;
  doubleTap(): void;
  hold(): void;
  flick(dx: number, dy: number, speed: number, hard: boolean): void;
  petting(active: boolean): void;
  /** Circling started, changed speed, or (active = false) stopped. */
  circle(active: boolean, turnsPerSec: number): void;
  hitsMascot(u: number, v: number): boolean;
}

const TAP_MAX_MOVE = 0.025;
const TAP_MAX_TIME = 0.45;
const DOUBLE_TAP_GAP = 0.32; // second tap must land within this
const HOLD_TIME = 0.6;
const FLICK_MIN_SPEED = 1.6;
const FLICK_HARD_SPEED = 4.2;
const PET_MIN_SWING = 0.02; // a rub stroke must travel at least this far
const PET_REVERSALS = 3; // direction changes within PET_WINDOW to count
const PET_WINDOW = 1.4;
const PET_IDLE_END = 0.7; // stop petting after this long without a stroke
const CIRCLE_WINDOW = 1.6; // seconds of path examined (long enough for slow loops)
const CIRCLE_START_TURNS = 0.6; // this much of a loop before it counts
const CIRCLE_KEEP_TURNS = 0.3; // keep turning at least this much per window
const CIRCLE_RATE_WINDOW = 0.5; // speed is measured over just the latest part
const CIRCLE_MIN_RADIUS = 0.018;
// Variance ratio of the path's narrow axis to its wide one: ~1 for a circle,
// ~0 for a straight rub.
const CIRCLE_ROUNDNESS = 0.12;
const CIRCLE_STOP_AFTER = 0.35; // pointer still this long ends circling

interface Sample {
  u: number;
  v: number;
  t: number;
}

export class GestureRecognizer {
  private down = false;
  private onMascot = false;
  private start: Sample = { u: 0, v: 0, t: 0 };
  private samples: Sample[] = [];
  private maxMove = 0;

  // petting
  private dirSign = 0;
  private swingFrom = 0;
  private reversals: number[] = [];
  private petActive = false;
  private petEverThisPress = false;
  private lastReversal = 0;

  // circles
  private trail: Sample[] = [];
  private circling = false;
  private circleEver = false;
  private lastMoveT = 0;

  // taps and holds
  private pendingTap: number | null = null; // time of a tap awaiting a partner
  private held = false;

  constructor(private h: GestureHandlers) {}

  pointerDown(u: number, v: number, t: number) {
    this.down = true;
    this.onMascot = this.h.hitsMascot(u, v);
    this.start = { u, v, t };
    this.samples = [this.start];
    this.maxMove = 0;
    this.dirSign = 0;
    this.swingFrom = u;
    this.reversals = [];
    this.petEverThisPress = false;
    this.held = false;
    this.trail = [this.start];
    this.circleEver = false;
    this.lastMoveT = t;
  }

  pointerMove(u: number, v: number, t: number) {
    if (!this.down) return;
    const prev = this.samples[this.samples.length - 1];
    this.samples.push({ u, v, t });
    // keep ~200 ms of history for release velocity
    while (this.samples.length > 2 && t - this.samples[0].t > 0.2) this.samples.shift();
    this.maxMove = Math.max(this.maxMove, Math.hypot(u - this.start.u, v - this.start.v));
    if (!this.onMascot) return; // only a press on the mascot rubs or circles
    this.lastMoveT = t;

    // Circling is checked first: a loop also has left/right reversals, which
    // would otherwise read as a rub.
    this.trail.push({ u, v, t });
    while (this.trail.length > 2 && t - this.trail[0].t > CIRCLE_WINDOW) this.trail.shift();
    if (!this.petActive) {
      const m = this.measureCircle();
      if (!this.circling) {
        if (m && Math.abs(m.turns) >= CIRCLE_START_TURNS && m.secs > 0.25) {
          this.circling = true;
          this.circleEver = true;
          this.h.circle(true, m.rate);
        }
      } else if (!m || (m.secs > 0.5 && Math.abs(m.turns) < CIRCLE_KEEP_TURNS)) {
        this.stopCircling();
      } else {
        this.h.circle(true, m.rate);
      }
    }
    if (this.circleEver) return;

    // Petting: count horizontal direction reversals of meaningful size.
    const du = u - prev.u;
    if (Math.abs(du) > 1e-4) {
      const sign = Math.sign(du);
      if (this.dirSign !== 0 && sign !== this.dirSign) {
        if (Math.abs(prev.u - this.swingFrom) >= PET_MIN_SWING) {
          this.reversals.push(t);
          this.lastReversal = t;
        }
        this.swingFrom = prev.u;
      }
      this.dirSign = sign;
    }
    this.reversals = this.reversals.filter((r) => t - r < PET_WINDOW);
    if (!this.petActive && this.reversals.length >= PET_REVERSALS) {
      this.petActive = true;
      this.petEverThisPress = true;
      this.h.petting(true);
    }
  }

  pointerUp(u: number, v: number, t: number) {
    if (!this.down) return;
    this.down = false;
    this.pointerMove(u, v, t);

    if (this.petActive) {
      this.petActive = false;
      this.h.petting(false);
    }
    if (this.circling) this.stopCircling();
    // A rub or circles that end mid-stroke aren't a flick, and a hold has
    // already fired.
    if (this.petEverThisPress || this.circleEver || this.held) return;

    const dur = t - this.start.t;
    if (this.maxMove < TAP_MAX_MOVE && dur < TAP_MAX_TIME) {
      if (!this.onMascot) return;
      if (this.pendingTap !== null && t - this.pendingTap < DOUBLE_TAP_GAP) {
        this.pendingTap = null;
        this.h.doubleTap();
      } else {
        this.pendingTap = t;
      }
      return;
    }

    // Release velocity over the recent window.
    const first = this.samples[0];
    const dt = Math.max(1e-3, t - first.t);
    const vx = (u - first.u) / dt;
    const vy = (v - first.v) / dt;
    const speed = Math.hypot(vx, vy);
    if (speed >= FLICK_MIN_SPEED) {
      this.h.flick(vx / speed, vy / speed, speed, speed >= FLICK_HARD_SPEED);
    }
  }

  private stopCircling() {
    this.circling = false;
    this.h.circle(false, 0);
  }

  /**
   * How far round the recent path has gone (signed turns, + = anticlockwise
   * with v up), over how long, and the current speed in turns per second from
   * just the latest part (so walk/run follows speed changes quickly). Null if
   * the path isn't round: too small, or flattened into a line like a rub.
   */
  private measureCircle(): { turns: number; secs: number; rate: number } | null {
    const tr = this.trail;
    const n = tr.length;
    if (n < 6) return null;
    let cx = 0;
    let cy = 0;
    for (const p of tr) {
      cx += p.u;
      cy += p.v;
    }
    cx /= n;
    cy /= n;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of tr) {
      const dx = p.u - cx;
      const dy = p.v - cy;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    sxx /= n;
    syy /= n;
    sxy /= n;
    // Eigenvalues of the 2x2 covariance: spread along the path's wide and
    // narrow axes.
    const half = (sxx + syy) / 2;
    const disc = Math.sqrt(Math.max(0, half * half - (sxx * syy - sxy * sxy)));
    const wide = half + disc;
    const narrow = half - disc;
    if (Math.sqrt(2 * wide) < CIRCLE_MIN_RADIUS || narrow / wide < CIRCLE_ROUNDNESS) return null;

    const tEnd = tr[n - 1].t;
    let sum = 0;
    let recent = 0;
    let recentFrom = tEnd;
    let prev = Math.atan2(tr[0].v - cy, tr[0].u - cx);
    for (let i = 1; i < n; i++) {
      const a = Math.atan2(tr[i].v - cy, tr[i].u - cx);
      let d = a - prev;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) < 1.2) {
        // skip jumps through the centre
        sum += d;
        if (tEnd - tr[i - 1].t <= CIRCLE_RATE_WINDOW) {
          recent += d;
          recentFrom = Math.min(recentFrom, tr[i - 1].t);
        }
      }
      prev = a;
    }
    const secs = tEnd - tr[0].t;
    const recentSecs = tEnd - recentFrom;
    // Until the trail covers a whole loop its centre is only estimated, which
    // inflates the recent speed; use the plain average until then.
    const fullLoop = Math.abs(sum) >= 2 * Math.PI;
    const rate = fullLoop && recentSecs > 0.1 ? recent / recentSecs : sum / Math.max(secs, 1e-3);
    return { turns: sum / (2 * Math.PI), secs, rate: rate / (2 * Math.PI) };
  }

  /**
   * Call every frame: fires a single tap once no second tap can follow, fires
   * a hold once the press has stayed still long enough, and ends petting once
   * the rubbing stops.
   */
  update(t: number) {
    if (this.pendingTap !== null && t - this.pendingTap >= DOUBLE_TAP_GAP) {
      this.pendingTap = null;
      this.h.tap();
    }
    if (
      this.down && this.onMascot && !this.held && !this.petEverThisPress && !this.circleEver &&
      this.maxMove < TAP_MAX_MOVE && t - this.start.t >= HOLD_TIME
    ) {
      this.held = true;
      this.h.hold();
    }
    if (this.circling && t - this.lastMoveT > CIRCLE_STOP_AFTER) this.stopCircling();
    if (this.petActive && t - this.lastReversal > PET_IDLE_END) {
      this.petActive = false;
      this.h.petting(false);
    }
  }
}
