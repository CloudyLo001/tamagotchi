import {
  AmbientLight,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from "three";
import { Mascot, MASCOT_HEIGHT } from "./mascot";

/**
 * How far the mascot may travel, in charm-world units (the view is about
 * ±0.88 wide at the floor). A knocked-down mascot lies with its head roughly
 * half its height past the hips, so knocks stop well short of the edge.
 */
const KNOCK_BOUND_X = 0.3;
const BOUND_Z_BACK = -0.5;
const BOUND_Z_FRONT = 0.3;
const RUN_SPEED = 1.4;
const WALK_SPEED = 0.45;
/** Radius of the loop the mascot travels while you draw circles. */
const CIRCLE_R = 0.28;
// Circling faster than this (turns per second) runs; slower walks. Two
// thresholds so it doesn't flicker between gaits right at the boundary.
const RUN_FROM_TPS = 1.0;
const WALK_BELOW_TPS = 0.8;
/** Loop angle of the home spot (the loop starts and ends there). */
const HOME_PHASE = -Math.PI / 2;
/** How long each randomly chosen circling style lasts before a re-pick. */
const STYLE_MIN_SECS = 2.5;
const STYLE_MAX_SECS = 5;
const ATTENTION_AFTER = 20; // seconds untouched before it waves at you
const HARD_FLICKS_TO_DIE = 3;
// Each knock plays out in full (fall, get up, run home) before the next flick
// counts, so "in a row" allows the time that takes.
const HARD_FLICK_WINDOW = 30; // seconds

type State =
  | "loading"
  | "idle"
  | "idle3"
  | "wave"
  | "pet"
  | "petEnd"
  | "heart"
  | "pain"
  | "shrug"
  | "cheer"
  | "circle"
  | "knock"
  | "down"
  | "getup"
  | "run"
  | "turn";

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

/** Soft radial floor shadow so the mascot sits on something in the dark. */
function shadowTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(0,0,0,0.55)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * The scene on the Muse Charm's screen: one mascot on a dark OLED-style stage,
 * reacting to gestures with the user's Mint animation clips.
 */
export class CharmWorld {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(30, 1, 0.1, 50);
  readonly mascot = new Mascot();
  private shadow: Mesh;
  /** Invisible sphere that follows the body, for tap/flick hit tests. */
  private hitProxy: Mesh;
  private raycaster = new Raycaster();

  private state: State = "loading";
  private stateT = 0;
  private idleT = 0; // time since last interaction
  private idleLoopT = 0; // time spent in the plain idle loop
  private hardFlicks: number[] = [];
  private clock = 0;

  // motion
  private slideFrom = new Vector3();
  private slideTo = new Vector3();
  private slideDur = 0;
  private targetYaw = 0;
  private homeSpeed = RUN_SPEED;

  // circling
  private circleCenter = new Vector3();
  private circlePhase = 0;
  private circleDir = 1;
  private circleSpeed = 0;
  private circleTarget = 0;
  /** Travelling round the loop, or moving on the spot at home. */
  private circleStyle: "loop" | "spot" = "loop";
  /** A switch to on-the-spot waits until the loop comes back home. */
  private wantSpot = false;
  private styleT = 0;
  private lapTravel = 0; // radians travelled since last leaving home
  private gait: "walk" | "run" | null = null;

  /** Sound hooks, wired by the Charm mode. */
  sfx: Partial<
    Record<"tap" | "soft" | "hard" | "dead" | "getup" | "pet" | "hello" | "heart" | "shrug" | "cheer", () => void>
  > = {};

  constructor() {
    this.camera.position.set(0, 0.7, 3.7);
    this.camera.lookAt(0, 0.42, 0);

    this.scene.background = new Color(0x07070b);
    this.scene.add(new AmbientLight(0xffffff, 0.95));
    const key = new DirectionalLight(0xfff4e6, 2.3);
    key.position.set(1.2, 2.4, 2.6);
    const rim = new DirectionalLight(0xb9d4ff, 0.9);
    rim.position.set(-1.6, 1.4, -1.8);
    this.scene.add(key, rim);

    this.shadow = new Mesh(
      new CircleGeometry(0.42, 32),
      new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.001;

    this.hitProxy = new Mesh(
      new SphereGeometry(0.46, 12, 12), // generous: a near miss still counts
      new MeshBasicMaterial({ visible: false }),
    );
    this.scene.add(this.mascot.root, this.shadow, this.hitProxy);
  }

  async load() {
    const ok = await this.mascot.load();
    if (ok) this.toIdle();
    return ok;
  }

  get isReady() {
    return this.mascot.ready;
  }

  // ---------------------------------------------------------------- queries

  /** Does a point on the screen (uv 0..1, v up) land on the mascot? */
  hitsMascot(u: number, v: number) {
    this.raycaster.setFromCamera(new Vector2(u * 2 - 1, v * 2 - 1), this.camera);
    return this.raycaster.intersectObject(this.hitProxy, false).length > 0;
  }

  // -------------------------------------------------------------- gestures

  /**
   * New gestures only start from rest: every animation (wave, ouch, fall,
   * get-up, cheer, run home, fidget) finishes before the next one begins.
   */
  private accepting() {
    return this.state === "idle" || this.state === "turn";
  }

  tap() {
    this.idleT = 0;
    if (!this.accepting()) return;
    this.hardFlicks = [];
    if (this.mascot.play("wave", { onDone: () => this.toIdle() })) {
      this.state = "wave";
      this.sfx.tap?.();
    }
  }

  /** Double tap: Big Heart Gesture. */
  doubleTap() {
    this.idleT = 0;
    if (!this.accepting()) return;
    this.hardFlicks = [];
    this.playHeart();
  }

  /** Press and hold on it: a puzzled shrug. */
  hold() {
    this.idleT = 0;
    if (!this.accepting()) return;
    this.hardFlicks = [];
    if (this.mascot.play("shrug", { onDone: () => this.toIdle() })) {
      this.state = "shrug";
      this.sfx.shrug?.();
    }
  }

  /** Big Heart is a slow 6 s clip; played a little quicker. */
  private playHeart() {
    if (this.mascot.play("heart", { fade: 0.25, timeScale: 1.3, onDone: () => this.toIdle() })) {
      this.state = "heart";
      this.sfx.heart?.();
      return true;
    }
    return false;
  }

  /**
   * A flick: `dx, dy` is the screen direction (v up), `speed` in screen
   * widths per second. Soft makes it hold its head (ouch) where it stands;
   * hard knocks it down; three hard flicks in a row and it plays dead.
   */
  flick(dx: number, dy: number, speed: number, hard: boolean) {
    this.idleT = 0;
    if (!this.accepting()) return;
    // Screen right = +x, screen up = away from the viewer (-z), foreshortened.
    const dir = new Vector3(dx, 0, -dy * 0.6);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    dir.normalize();

    if (hard) {
      this.hardFlicks = this.hardFlicks.filter((t) => this.clock - t < HARD_FLICK_WINDOW);
      this.hardFlicks.push(this.clock);
      if (this.hardFlicks.length >= HARD_FLICKS_TO_DIE && this.mascot.has("dead")) {
        this.hardFlicks = [];
        this.knock(dir, speed, "dead");
        return;
      }
      if (this.mascot.has("knock")) {
        this.knock(dir, speed, "knock");
        return;
      }
    }
    this.hardFlicks = []; // a soft flick breaks the streak
    if (this.mascot.play("pain", { fade: 0.15, onDone: () => this.toIdle() })) {
      this.state = "pain";
      this.sfx.soft?.();
    }
  }

  private knock(dir: Vector3, speed: number, clip: "knock" | "dead") {
    // Fall back and away from the viewer rather than flat sideways: it reads
    // as more 3D, and a body lying into the screen fits the frame.
    dir = new Vector3(dir.x, 0, dir.z - 0.9).normalize();
    const dist = Math.min(0.4, 0.2 + speed * 0.03);
    // Face the flick so it falls backwards, away from your finger.
    this.faceDirection(dir.clone().negate(), true);
    this.startSlide(dir, dist, 0.75, KNOCK_BOUND_X);
    this.mascot.play(clip, {
      fade: 0.1,
      onDone: () => {
        this.state = "down";
        this.stateT = 0;
      },
    });
    this.state = "knock";
    if (clip === "dead") this.sfx.dead?.();
    else this.sfx.hard?.();
  }

  /** Petting: jumping jacks while being rubbed; the last jump always lands. */
  petting(active: boolean) {
    this.idleT = 0;
    if (active) {
      if (!this.accepting()) return;
      this.hardFlicks = [];
      if (this.mascot.play("jacks", { fade: 0.2 })) {
        this.state = "pet";
        this.faceDirection(new Vector3(0, 0, 1), false);
        this.sfx.pet?.();
      }
    } else if (this.state === "pet") {
      // Land the last jump, then a heart to say thanks for the pets.
      this.state = "petEnd";
      this.mascot.finishLoop(() => {
        if (!this.playHeart()) this.toIdle();
      });
    }
  }

  /**
   * Draw circles while holding it: walking for slow circles and running for
   * fast ones. The style is random and re-picked every few seconds: either it
   * travels a loop on the stage the same way round as your finger, or it
   * moves on the spot at home. A loop only turns into on-the-spot once it has
   * come back round to home. When you stop, it goes back to the middle.
   */
  circle(active: boolean, turnsPerSec: number) {
    this.idleT = 0;
    if (active) {
      if (this.state !== "circle") {
        if (!this.accepting()) return;
        this.hardFlicks = [];
        // A loop that starts exactly where it stands, curving away from you.
        const p = this.mascot.root.position;
        this.circleCenter.set(p.x, 0, p.z - CIRCLE_R);
        this.circlePhase = HOME_PHASE;
        this.circleSpeed = 0;
        this.lapTravel = 0;
        this.circleStyle = Math.random() < 0.5 ? "loop" : "spot";
        this.wantSpot = this.circleStyle === "spot";
        this.styleT = randomBetween(STYLE_MIN_SECS, STYLE_MAX_SECS);
        this.gait = null;
        this.state = "circle";
      }
      if (turnsPerSec !== 0) this.circleDir = Math.sign(turnsPerSec);
      const tps = Math.abs(turnsPerSec);
      const fast = this.gait === "run" ? tps > WALK_BELOW_TPS : tps >= RUN_FROM_TPS;
      this.setGait(fast ? "run" : "walk");
      this.circleTarget = fast ? RUN_SPEED : WALK_SPEED;
    } else if (this.state === "circle") {
      this.recover(this.gait ?? "run");
    }
  }

  /** Walk clip if there is one; otherwise the run, slowed right down. */
  private playGait(gait: "walk" | "run") {
    if (gait === "walk" && this.mascot.has("walk")) this.mascot.play("walk", { fade: 0.25 });
    else this.mascot.play("run", { fade: 0.25, timeScale: gait === "walk" ? 0.5 : 1 });
  }

  private setGait(gait: "walk" | "run") {
    if (this.gait === gait) return;
    this.gait = gait;
    this.playGait(gait);
  }

  // ------------------------------------------------------------- recovery

  /** Go home if away from the middle (in the given gait), else face you. */
  private recover(gait: "walk" | "run" = "run") {
    const p = this.mascot.root.position;
    // Always go the last bit home, so small loops don't leave it drifting.
    if (Math.hypot(p.x, p.z) > 0.03 && this.mascot.has("run")) {
      this.faceDirection(new Vector3(-p.x, 0, -p.z), false);
      this.playGait(gait);
      this.homeSpeed = gait === "walk" ? WALK_SPEED : RUN_SPEED;
      this.state = "run";
    } else {
      this.faceCamera();
    }
  }

  private getUp() {
    this.state = "getup";
    this.sfx.getup?.();
    if (this.mascot.has("getup")) {
      // Stand Up1 is a slow 8 s clip; a toy should bounce back quicker.
      this.mascot.play("getup", { fade: 0.3, timeScale: 1.6, onDone: () => this.cheer() });
    } else {
      // No get-up clip synced: blend slowly back to standing.
      this.mascot.play("idle", { fade: 0.9 });
      this.stateT = 0;
    }
  }

  /** Back on its feet: a victory fist pump, then home. */
  private cheer() {
    if (this.mascot.play("victory", { fade: 0.2, onDone: () => this.recover() })) {
      this.state = "cheer";
      this.sfx.cheer?.();
    } else {
      this.recover();
    }
  }

  private faceCamera() {
    this.targetYaw = 0;
    this.state = "turn";
    this.stateT = 0;
    this.mascot.play("idle", { fade: 0.3 });
  }

  private toIdle() {
    this.state = "idle";
    this.idleLoopT = 0;
    this.mascot.play("idle", { fade: 0.3 });
  }

  // -------------------------------------------------------------- helpers

  private faceDirection(dir: Vector3, snap: boolean) {
    const yaw = Math.atan2(dir.x, dir.z);
    this.targetYaw = yaw;
    if (snap) this.mascot.root.rotation.y = yaw;
  }

  private startSlide(dir: Vector3, dist: number, dur: number, boundX: number) {
    const p = this.mascot.root.position;
    this.slideFrom.copy(p);
    this.slideTo.copy(p).addScaledVector(dir, dist);
    this.slideTo.x = Math.max(-boundX, Math.min(boundX, this.slideTo.x));
    this.slideTo.z = Math.max(BOUND_Z_BACK, Math.min(BOUND_Z_FRONT, this.slideTo.z));
    this.slideDur = Math.max(0.05, dur);
    this.stateT = 0;
  }

  /** One frame of circling: re-pick the style now and then, then move. */
  private updateCircle(dt: number) {
    const root = this.mascot.root;
    this.styleT -= dt;
    if (this.styleT <= 0) {
      this.styleT = randomBetween(STYLE_MIN_SECS, STYLE_MAX_SECS);
      const loop = Math.random() < 0.5;
      this.wantSpot = !loop;
      if (loop && this.circleStyle === "spot") {
        // Already home, so it can set off round the loop straight away.
        this.circleStyle = "loop";
        this.circlePhase = HOME_PHASE;
        this.circleSpeed = 0;
        this.lapTravel = 0;
      }
    }

    this.circleSpeed += (this.circleTarget - this.circleSpeed) * Math.min(1, dt * 4);

    if (this.circleStyle === "spot") {
      // On the spot at home, facing you.
      this.targetYaw = 0;
      return;
    }

    const step = (this.circleDir * this.circleSpeed * dt) / CIRCLE_R;
    const before = this.circlePhase;
    this.circlePhase += step;
    this.lapTravel += Math.abs(step);
    // Back at home after at least half a lap (leaving home doesn't count)?
    const lap = (a: number) => Math.floor((a - HOME_PHASE) / (2 * Math.PI));
    if (this.wantSpot && this.lapTravel > Math.PI && lap(before) !== lap(this.circlePhase)) {
      this.circleStyle = "spot";
      this.circlePhase = HOME_PHASE;
      this.lapTravel = 0;
    }
    const a = this.circlePhase;
    root.position.set(
      this.circleCenter.x + CIRCLE_R * Math.cos(a),
      0,
      this.circleCenter.z - CIRCLE_R * Math.sin(a),
    );
    if (this.circleStyle === "spot") this.targetYaw = 0;
    // Face along the loop.
    else this.faceDirection(new Vector3(-Math.sin(a) * this.circleDir, 0, -Math.cos(a) * this.circleDir), false);
  }

  // ---------------------------------------------------------------- update

  update(dt: number) {
    this.clock += dt;
    this.stateT += dt;
    const root = this.mascot.root;

    switch (this.state) {
      case "idle": {
        this.idleT += dt;
        this.idleLoopT += dt;
        if (this.idleT > ATTENTION_AFTER && this.mascot.has("wave")) {
          this.idleT = 0;
          this.mascot.play("wave", { onDone: () => this.toIdle() });
          this.state = "wave";
          this.sfx.hello?.();
        } else if (this.idleLoopT > 12 && Math.random() < dt * 0.15) {
          // Fidget: mostly Idle 3, sometimes a shrug.
          const clip = Math.random() < 0.35 && this.mascot.has("shrug") ? "shrug" : "idle3";
          if (this.mascot.play(clip, { fade: 0.4, onDone: () => this.toIdle() })) this.state = "idle3";
          else this.idleLoopT = 0;
        }
        break;
      }
      case "knock": {
        // Ease-out slide along the flick.
        const k = Math.min(1, this.stateT / this.slideDur);
        const e = 1 - Math.pow(1 - k, 3);
        root.position.lerpVectors(this.slideFrom, this.slideTo, e);
        break;
      }
      case "down":
        if (this.stateT > 0.6) this.getUp();
        break;
      case "getup":
        // Only used by the no-clip fallback (a timed blend).
        if (!this.mascot.has("getup") && this.stateT > 1.0) this.cheer();
        break;
      case "circle":
        this.updateCircle(dt);
        break;
      case "run": {
        const p = root.position;
        const d = Math.hypot(p.x, p.z);
        const step = this.homeSpeed * dt;
        if (d <= step) {
          p.set(0, 0, 0);
          this.faceCamera();
        } else {
          p.x -= (p.x / d) * step;
          p.z -= (p.z / d) * step;
        }
        break;
      }
      case "turn": {
        // Compare on the circle: knockbacks leave yaw at any angle.
        const off = this.targetYaw - root.rotation.y;
        if (Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) < 0.05) {
          root.rotation.y = this.targetYaw;
          this.toIdle();
        }
        break;
      }
    }

    // Turn smoothly toward targetYaw (shortest way round).
    let dy = this.targetYaw - root.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    root.rotation.y += dy * Math.min(1, dt * 8);

    this.mascot.update(dt);

    // Shadow and hit sphere follow the body, not just the root, so a mascot
    // lying on the floor is still grabbable where it actually is.
    const hips = this.mascot.hipsWorld(new Vector3());
    this.shadow.position.set(hips.x, 0.001, hips.z);
    this.hitProxy.position.set(hips.x, Math.max(0.3, hips.y + MASCOT_HEIGHT * 0.18), hips.z);
  }
}
