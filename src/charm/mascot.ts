import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Box3,
  Group,
  LoopOnce,
  LoopRepeat,
  Object3D,
  Vector3,
} from "three";
import { assetUrl, assetUrlByRole, loadGltf } from "../assets/registry";

/**
 * The Muse mascot: a rigged character from Mint plus the animation clips made
 * for it. Clips stream in after the rig so the mascot appears quickly; anything
 * not loaded yet is simply skipped by `has()`.
 */

export type ClipName =
  | "idle"
  | "idle3"
  | "wave"
  | "knock"
  | "dead"
  | "jacks"
  | "run"
  | "getup"
  | "heart"
  | "pain"
  | "shrug"
  | "victory"
  | "walk";

/**
 * Where each clip lives: registry key + Mint clip ID. The first batch
 * (`muse-mascot`) also holds Roll Dodge, which the Charm no longer uses, so it
 * is simply never loaded.
 */
// Partial: a clip without an entry (e.g. a walk not yet made on Mint) is simply
// never loaded, and callers fall back via has().
const CLIPS: Partial<Record<Exclude<ClipName, "getup">, [key: string, clipId: string]>> = {
  idle: ["muse-mascot", "w976fd0q06zdf2b3r59wm9d6rh8f14cd"],
  dead: ["muse-mascot", "w97fs0mfsyejak1s88znvseaws8f01mb"],
  wave: ["muse-mascot", "w97cetahj70nast2t9v331e24x8f0a0n"],
  knock: ["muse-mascot", "w97dgy3bteqyah1adc9pa1ywzx8f1hdk"],
  idle3: ["muse-mascot", "w974m3ed9dt61cwjv33cpmcfen8f1dpp"],
  jacks: ["muse-mascot", "w975bj4ca2xnt9xnen2edkntvn8f0rbn"],
  run: ["muse-mascot", "w973ww80rf081rtvmeg3f3ween8f0v5x"],
  victory: ["muse-mascot-extra", "w977b84q9bsty4apmzv9p2bd358f4e5h"],
  heart: ["muse-mascot-extra", "w977h3c71b073gs5z36ycers958f4t9p"],
  pain: ["muse-mascot-extra", "w97anpyqs6chn1cveyfy7xrx298f52ez"],
  shrug: ["muse-mascot-extra", "w97ffhnqzgkn9e3vcgk1wjvcn98f56bj"],
};

/** Stream order: idle first so the mascot comes alive, then likely reactions. */
const LOAD_ORDER: ClipName[] = [
  "idle", "wave", "pain", "heart", "knock", "getup", "victory", "run", "walk", "jacks", "shrug", "dead", "idle3",
];

/** Clips that play once; the rest loop. */
const ONE_SHOT = new Set<ClipName>([
  "wave", "knock", "dead", "getup", "idle3", "heart", "pain", "shrug", "victory",
]);

/** Display height of the mascot in charm-world units. */
export const MASCOT_HEIGHT = 1.0;

function clipUrl(name: ClipName): string | null {
  if (name === "getup") return assetUrlByRole("muse-mascot-getup", "animation_clip");
  const entry = CLIPS[name];
  if (!entry) return null;
  return assetUrl(entry[0], `clip:${entry[1]}:animation_glb`);
}

/**
 * Strip horizontal root motion (keep vertical) so every clip plays in place.
 * The Charm moves the mascot itself — a flick sends it where you flicked, not
 * wherever the animator's knock-down happened to travel.
 *
 * Pinned to the rig's rest pose, not each clip's first frame: some clips
 * (Knock Down, Stand Up1) start with the hips well off-centre, which would
 * leave the body beside its root and shadow.
 */
function toInPlace(clip: AnimationClip, rest: Vector3 | null): AnimationClip {
  const c = clip.clone();
  for (const t of c.tracks) {
    if (!t.name.endsWith(".position") || !/hips/i.test(t.name)) continue;
    const v = t.values;
    const x0 = rest ? rest.x : v[0];
    const z0 = rest ? rest.z : v[2];
    for (let i = 0; i < v.length; i += 3) {
      v[i] = x0;
      v[i + 2] = z0;
    }
  }
  return c;
}

export class Mascot {
  /** Floor position and facing (y rotation) live here. */
  readonly root = new Group();
  private model: Object3D | null = null;
  private hips: Object3D | null = null;
  private restHips: Vector3 | null = null;
  private mixer: AnimationMixer | null = null;
  private actions = new Map<ClipName, AnimationAction>();
  private current: AnimationAction | null = null;
  private currentName: ClipName | null = null;
  private onDone: (() => void) | null = null;
  ready = false;

  /** Load the rig, start idling, then stream the remaining clips. */
  async load(): Promise<boolean> {
    const url = assetUrl("muse-mascot", "rigged_character_glb");
    if (!url) return false;
    const gltf = await loadGltf(url);
    if (!gltf) return false;

    const model = gltf.scene;
    // Fit to MASCOT_HEIGHT, feet on the floor, centred.
    model.updateMatrixWorld(true);
    const box = new Box3().setFromObject(model);
    const size = box.getSize(new Vector3());
    const s = size.y > 1e-6 ? MASCOT_HEIGHT / size.y : 1;
    model.scale.multiplyScalar(s);
    model.updateMatrixWorld(true);
    const b2 = new Box3().setFromObject(model);
    const c = b2.getCenter(new Vector3());
    model.position.x -= c.x;
    model.position.z -= c.z;
    model.position.y -= b2.min.y;
    model.traverse((o) => {
      o.frustumCulled = false; // skinned bounds don't follow the pose
      if (/^hips$/i.test(o.name)) this.hips = o;
    });
    this.restHips = this.hips ? this.hips.position.clone() : null;

    this.model = model;
    this.root.add(model);
    this.mixer = new AnimationMixer(model);
    this.mixer.addEventListener("finished", (e) => {
      if (e.action === this.current && this.onDone) {
        const cb = this.onDone;
        this.onDone = null;
        cb();
      }
    });

    await this.loadClip("idle");
    this.ready = true;
    this.play("idle");
    // Remaining clips in the background, in likely-needed order.
    void (async () => {
      for (const name of LOAD_ORDER) if (!this.actions.has(name)) await this.loadClip(name);
    })();
    return true;
  }

  private async loadClip(name: ClipName) {
    const url = clipUrl(name);
    if (!url || !this.mixer) return;
    const gltf = await loadGltf(url);
    const clip = gltf?.animations[0];
    if (!clip) return;
    this.actions.set(name, this.mixer.clipAction(toInPlace(clip, this.restHips)));
  }

  has(name: ClipName) {
    return this.actions.has(name);
  }

  get playing() {
    return this.currentName;
  }

  duration(name: ClipName) {
    return this.actions.get(name)?.getClip().duration ?? 0;
  }

  /**
   * Cross-fade to a clip. One-shots call `onDone` when they finish; a new
   * play() replaces any pending callback. Returns false if not loaded yet.
   */
  play(name: ClipName, opts: { fade?: number; onDone?: () => void; timeScale?: number } = {}) {
    const next = this.actions.get(name);
    if (!next) return false;
    const fade = opts.fade ?? 0.25;
    // Set every time: finishLoop() may have switched a looping clip to once.
    if (ONE_SHOT.has(name)) next.setLoop(LoopOnce, 1);
    else next.setLoop(LoopRepeat, Infinity);
    next.clampWhenFinished = true; // one-shots hold their last pose (lying down, etc.)
    next.reset();
    next.setEffectiveTimeScale(opts.timeScale ?? 1);
    next.setEffectiveWeight(1);
    next.play();
    if (this.current && this.current !== next) this.current.crossFadeTo(next, fade, false);
    this.current = next;
    this.currentName = name;
    this.onDone = opts.onDone ?? null;
    return true;
  }

  /**
   * Let the current looping clip play to the end of this cycle, then call
   * `onDone`, so a loop is never cut off mid-move.
   */
  finishLoop(onDone: () => void) {
    const a = this.current;
    if (!a || !a.isRunning()) return onDone();
    a.setLoop(LoopOnce, 1);
    this.onDone = onDone;
  }

  /** Hips position in world space (tracks the body when it falls or lies). */
  hipsWorld(target: Vector3) {
    if (this.hips) return this.hips.getWorldPosition(target);
    return this.root.getWorldPosition(target).setY(MASCOT_HEIGHT * 0.45);
  }

  update(dt: number) {
    this.mixer?.update(dt);
  }
}
