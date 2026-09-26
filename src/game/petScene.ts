import {
  AmbientLight,
  Box3,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector3,
} from "three";
import { CHARACTERS, CharacterDef, CharacterId, PROP_ASSET_KEYS } from "../sim/data";
import type { PetSnapshot } from "../sim/pet";
import type { OutfitId } from "../sim/save";
import { loadModel, normalizeModel, packItemGlbUrl } from "../assets/registry";
import { OutfitDef, outfitDef, outfitGlbUrl } from "./outfits";

const CHARACTER_PACK_KEY = "characters";

/** Length of one greeting (hop, two rocks, settle), seconds. */
const GREET_SECONDS = 1.1;
/** Parade hold per look — matches the 1 s hard cuts in the reference clip. */
const PARADE_STEP_SECONDS = 1.0;

/**
 * Where accessories attach on the current pet, in the pet body's local space.
 * Measured by raycasting the installed model, so any generated shape works.
 */
interface OutfitAnchors {
  headX: number;
  headZ: number;
  headTop: number;
  headWidth: number;
  eyeY: number;
  faceZ: number;
  neckY: number;
  neckZ: number;
}

type PropKind = keyof typeof PROP_ASSET_KEYS;

/**
 * Multiply every material's base color by `color`, on cloned materials so the
 * shared cached originals are never mutated.
 */
function tint(root: Object3D, color: number) {
  const c = new Color(color);
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const apply = (m: MeshStandardMaterial) => {
      const copy = m.clone() as MeshStandardMaterial;
      if (copy.color) copy.color.multiply(c);
      return copy;
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => apply(m as MeshStandardMaterial))
      : apply(mesh.material as MeshStandardMaterial);
  });
}

// ---------------------------------------------------------------- placeholders

function blobMaterial(color: number) {
  return new MeshStandardMaterial({ color, roughness: 0.55, metalness: 0 });
}

function addEyes(parent: Group, y: number, z: number, spread = 0.16, r = 0.05) {
  const mat = new MeshStandardMaterial({ color: 0x1c1c24, roughness: 0.3 });
  for (const side of [-1, 1]) {
    const eye = new Mesh(new SphereGeometry(r, 12, 12), mat);
    eye.position.set(side * spread, y, z);
    parent.add(eye);
  }
}

/** Distinct clearly-labeled placeholder blobs so play never blocks on assets. */
function buildPlaceholderCharacter(id: CharacterId, eggColor: "white" | "pink"): Group {
  const def = CHARACTERS[id];
  const g = new Group();
  const h = def.height;

  if (id === "egg") {
    const shellColor = eggColor === "pink" ? 0xffc4de : 0xffffff;
    const dotColor = eggColor === "pink" ? 0xffffff : 0xe6399b;
    const body = new Mesh(new SphereGeometry(h * 0.42, 24, 24), blobMaterial(shellColor));
    body.scale.set(1, 1.25, 1);
    body.position.y = h * 0.5;
    g.add(body);
    const dotMat = blobMaterial(dotColor);
    const dots: [number, number, number][] = [
      [0.3, 0.75, 0.55], [-0.45, 0.5, 0.4], [0.15, 0.3, 0.7],
      [-0.2, 0.85, -0.45], [0.5, 0.45, -0.35], [-0.05, 0.6, 0.72],
    ];
    for (const [dx, dy, dz] of dots) {
      const d = new Mesh(new SphereGeometry(h * 0.09, 10, 10), dotMat);
      const dir = new Vector3(dx, 0, dz).normalize().multiplyScalar(h * 0.38);
      d.position.set(dir.x, h * 0.5 + (dy - 0.55) * h * 0.8, dir.z);
      d.scale.z = 0.45;
      d.lookAt(0, h * 0.5, 0);
      g.add(d);
    }
    return g;
  }

  const mat = blobMaterial(def.fallbackColor);
  switch (def.fallbackShape) {
    case "sphere": {
      const body = new Mesh(new SphereGeometry(h * 0.5, 24, 24), mat);
      body.position.y = h * 0.5;
      g.add(body);
      addEyes(g, h * 0.58, h * 0.42, h * 0.17, h * 0.055);
      break;
    }
    case "bean": {
      const body = new Mesh(new SphereGeometry(h * 0.42, 24, 24), mat);
      body.scale.set(0.95, 1.25, 0.9);
      body.position.y = h * 0.5;
      g.add(body);
      addEyes(g, h * 0.62, h * 0.36, h * 0.15, h * 0.05);
      break;
    }
    case "tall": {
      const body = new Mesh(new CylinderGeometry(h * 0.26, h * 0.34, h * 0.8, 20), mat);
      body.position.y = h * 0.45;
      g.add(body);
      const head = new Mesh(new SphereGeometry(h * 0.28, 20, 20), mat);
      head.position.y = h * 0.88;
      g.add(head);
      addEyes(g, h * 0.9, h * 0.24, h * 0.12, h * 0.045);
      break;
    }
    case "snake": {
      let y = h * 0.12;
      let r = h * 0.2;
      for (let i = 0; i < 4; i++) {
        const seg = new Mesh(new SphereGeometry(r, 16, 16), mat);
        seg.position.set(Math.sin(i * 1.1) * h * 0.08, y, 0);
        g.add(seg);
        y += r * 1.35;
        r *= 0.92;
      }
      addEyes(g, y - h * 0.1, h * 0.14, h * 0.09, h * 0.04);
      break;
    }
  }
  return g;
}

function buildPlaceholderProp(kind: PropKind): Group {
  const g = new Group();
  switch (kind) {
    case "poop": {
      const mat = blobMaterial(0x8a5a33);
      const sizes = [0.22, 0.16, 0.1];
      let y = 0.1;
      for (const r of sizes) {
        const s = new Mesh(new SphereGeometry(r, 14, 14), mat);
        s.scale.y = 0.7;
        s.position.y = y;
        g.add(s);
        y += r * 0.9;
      }
      break;
    }
    case "bread": {
      const loaf = new Mesh(new SphereGeometry(0.28, 16, 16), blobMaterial(0xc98b4a));
      loaf.scale.set(1.3, 0.75, 0.8);
      loaf.position.y = 0.21;
      g.add(loaf);
      break;
    }
    case "candy": {
      const ball = new Mesh(new SphereGeometry(0.2, 16, 16), blobMaterial(0xff86b6));
      ball.position.y = 0.2;
      g.add(ball);
      const wrapMat = blobMaterial(0xffd0e4);
      for (const side of [-1, 1]) {
        const tip = new Mesh(new ConeGeometry(0.09, 0.18, 10), wrapMat);
        tip.rotation.z = side * (Math.PI / 2);
        tip.position.set(side * 0.28, 0.2, 0);
        g.add(tip);
      }
      break;
    }
    case "skull": {
      const skull = new Mesh(new SphereGeometry(0.2, 16, 16), blobMaterial(0xf2f2ee));
      skull.position.y = 0.22;
      g.add(skull);
      const eyeMat = blobMaterial(0x222228);
      for (const side of [-1, 1]) {
        const eye = new Mesh(new SphereGeometry(0.05, 8, 8), eyeMat);
        eye.position.set(side * 0.08, 0.24, 0.16);
        g.add(eye);
      }
      break;
    }
    case "tombstone": {
      const stone = new Mesh(new CylinderGeometry(0.32, 0.32, 0.55, 24, 1, false, 0, Math.PI), blobMaterial(0x9aa0ad));
      stone.scale.z = 0.35;
      stone.position.y = 0.45;
      g.add(stone);
      const base = new Mesh(new CylinderGeometry(0.42, 0.46, 0.18, 20), blobMaterial(0x7fae6b));
      base.position.y = 0.09;
      g.add(base);
      break;
    }
  }
  return g;
}

// --------------------------------------------------------------- outfit fit

const raycaster = new Raycaster();

/** First hit of a ray against `target`, or null. */
function castRay(target: Object3D, origin: Vector3, dir: Vector3) {
  raycaster.set(origin, dir);
  const hits = raycaster.intersectObject(target, true);
  return hits.length ? hits[0].point : null;
}

/**
 * Measure where a hat, glasses or bow tie should sit on this model. The model
 * must be detached (no parent) so its world space equals the pet body's local
 * space. Every measurement falls back to the bounding box if a ray misses.
 */
function measureAnchors(model: Object3D, def: CharacterDef): OutfitAnchors {
  model.updateMatrixWorld(true);
  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  const height = Math.max(box.max.y, 1e-3);
  const cz = (box.min.z + box.max.z) / 2;
  const above = box.max.y + 1;
  const down = new Vector3(0, -1, 0);

  // Head top: highest surface over a grid spanning the full width AND depth.
  // Heads are not always centred: the snake's stands behind a tail that coils
  // toward the viewer, so a single line of probes along z=0 only finds tail.
  // Probes go centre-out; an off-centre one only wins if clearly higher, so
  // small bumps like ears don't pull hats sideways.
  const cx = (box.min.x + box.max.x) / 2;
  const probes: { x: number; z: number; d: number }[] = [];
  for (let i = -6; i <= 6; i++) {
    for (let j = -2; j <= 2; j++) {
      probes.push({
        x: cx + (i / 6) * size.x * 0.48,
        z: cz + (j / 2) * size.z * 0.45,
        d: Math.abs(i) + Math.abs(j) * 1.5,
      });
    }
  }
  probes.sort((a, b) => a.d - b.d);
  let headX = cx;
  let headZ = cz;
  let headTop = -Infinity;
  for (const p of probes) {
    const hit = castRay(model, new Vector3(p.x, above, p.z), down);
    if (hit && hit.y > headTop + (p.d === 0 ? 0 : 0.08 * height)) {
      headTop = hit.y;
      headX = p.x;
      headZ = p.z;
    }
  }
  if (!Number.isFinite(headTop)) headTop = box.max.y;

  // Head width: horizontal rays just under the crown, at the head's depth.
  const wy = headTop - (def.headDrop ?? 0.14) * height;
  const left = castRay(model, new Vector3(box.min.x - 1, wy, headZ), new Vector3(1, 0, 0));
  const right = castRay(model, new Vector3(box.max.x + 1, wy, headZ), new Vector3(-1, 0, 0));
  const headWidth =
    left && right && right.x - left.x > 0.05 ? right.x - left.x : size.x * 0.7;
  const midX = left && right ? (left.x + right.x) / 2 : headX;

  const front = new Vector3(0, 0, -1);
  const eyeY = height * (def.eyeY ?? 0.62);
  const eyeHit = castRay(model, new Vector3(midX, eyeY, box.max.z + 1), front);
  const neckY = height * (def.neckY ?? 0.36);
  const neckHit = castRay(model, new Vector3(midX, neckY, box.max.z + 1), front);

  return {
    headX: midX,
    headZ,
    headTop,
    headWidth,
    eyeY,
    faceZ: eyeHit ? eyeHit.z : box.max.z,
    neckY,
    neckZ: neckHit ? neckHit.z : box.max.z,
  };
}

/**
 * Scale an accessory to `width` and place it on the anchors. Head items rest
 * their base on the crown; face and neck items sit on the front surface.
 */
function fitAccessory(obj: Object3D, def: OutfitDef, a: OutfitAnchors) {
  obj.position.set(0, 0, 0);
  obj.scale.setScalar(1);
  obj.updateMatrixWorld(true);
  const box = new Box3().setFromObject(obj);
  const size = box.getSize(new Vector3());
  const scale = size.x > 1e-6 ? (a.headWidth * def.fitWidth) / size.x : 1;
  obj.scale.setScalar(scale);
  obj.updateMatrixWorld(true);

  const b = new Box3().setFromObject(obj);
  const c = b.getCenter(new Vector3());
  // Normalise so the accessory is centred on x, and z/y per slot below.
  if (def.slot === "head") {
    obj.position.set(
      a.headX - c.x,
      a.headTop - def.sink * a.headWidth - b.min.y,
      a.headZ - c.z,
    );
  } else {
    const y = def.slot === "face" ? a.eyeY : a.neckY;
    const z = def.slot === "face" ? a.faceZ : a.neckZ;
    // Front of the accessory just proud of the surface; any glasses arms that
    // reach backwards disappear into the head.
    obj.position.set(a.headX - c.x, y - c.y, z + 0.015 - b.max.z);
  }
}

// ------------------------------------------------------------------ the world

export type PetPose = "idle" | "sleep" | "sulk" | "dead" | "egg";

/**
 * The scene that lives inside the device's LCD: pet, poops, food, tombstone,
 * all animated procedurally (hop, squash-and-stretch, shuffle, breathing).
 */
export class PetWorld {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  private petHolder = new Group(); // moves around the floor
  private petBody = new Group(); // squash/stretch; holds model + outfit
  // Outfit is a sibling of the model inside petBody, so it inherits every
  // hop, squash, sleep roll and turn without separate animation.
  private modelSlot = new Group();
  private outfitSlot = new Group();
  private currentCharacter: CharacterId | null = null;
  private currentEggColor: "white" | "pink" = "white";
  private loadToken = 0;

  // outfits
  private anchors: OutfitAnchors | null = null;
  private outfitId: OutfitId = "none";
  private outfitToken = 0;
  private outfitProtos = new Map<string, Promise<Object3D | null>>();
  /** Loaded protos, readable synchronously so a parade cut takes one frame. */
  private resolvedProtos = new Map<string, Object3D | null>();

  // greeting + parade
  private greetT = -1; // -1 = idle, else seconds into the greeting
  private greetLoop = false;
  private parade: { ids: OutfitId[]; index: number; t: number; onStep?: (id: OutfitId) => void } | null = null;

  private poopGroup = new Group();
  private foodHolder = new Group();
  private skullHolder = new Group();
  private tombstoneHolder = new Group();
  private propCache = new Map<string, Object3D>();

  private ambient: AmbientLight;
  private keyLight: DirectionalLight;
  private bgLit = new Color(0xf4efdd);
  private bgDark = new Color(0x131622);

  // animation state
  private time = 0;
  private hopPhase = 0;
  private facing = 1;
  private feedingT = -1;
  private turn = 0; // -1 left, 1 right (mini-game)
  private targetTurn = 0;

  constructor() {
    this.camera = new PerspectiveCamera(38, 1, 0.1, 50);
    this.camera.position.set(0, 1.05, 4.1);
    this.camera.lookAt(0, 0.62, 0);

    this.scene.background = this.bgLit.clone();
    this.ambient = new AmbientLight(0xffffff, 0.85);
    this.keyLight = new DirectionalLight(0xfff6e0, 1.6);
    this.keyLight.position.set(1.4, 2.6, 2.2);
    this.scene.add(this.ambient, this.keyLight);

    const floor = new Mesh(
      new CircleGeometry(3.2, 40),
      new MeshStandardMaterial({ color: 0xe4dcc4, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    this.petBody.add(this.modelSlot, this.outfitSlot);
    this.petHolder.add(this.petBody);
    this.scene.add(this.petHolder, this.poopGroup, this.foodHolder, this.skullHolder, this.tombstoneHolder);
    this.foodHolder.visible = false;
    this.skullHolder.visible = false;
    this.tombstoneHolder.visible = false;
  }

  // ------------------------------------------------------------- characters

  setCharacter(id: CharacterId, eggColor: "white" | "pink") {
    if (this.currentCharacter === id && this.currentEggColor === eggColor) return;
    this.currentCharacter = id;
    this.currentEggColor = eggColor;
    const def = CHARACTERS[id];
    const token = ++this.loadToken;

    // Placeholder immediately; swap in the generated model when it arrives.
    this.installPetModel(buildPlaceholderCharacter(id, eggColor));
    const url = packItemGlbUrl(CHARACTER_PACK_KEY, def.assetKey);
    if (url) {
      void loadModel(url).then((model) => {
        if (!model || token !== this.loadToken) return;
        normalizeModel(model, def.height);
        // Cosmetic egg variant only. Object3D.clone() shares materials with the
        // cached original, so tint a *copy* — mutating the shared material
        // would compound the multiply on every reload.
        if (id === "egg" && eggColor === "pink") tint(model, 0xffc2dd);
        this.installPetModel(model);
      });
    }
  }

  private installPetModel(model: Object3D) {
    // Measure while detached: its world space then equals petBody-local space.
    model.removeFromParent();
    this.anchors = this.currentCharacter
      ? measureAnchors(model, CHARACTERS[this.currentCharacter])
      : null;
    this.modelSlot.clear();
    this.modelSlot.add(model);
    // The new body has a different head — refit whatever is being worn.
    this.applyOutfit(this.outfitId);
  }

  // ---------------------------------------------------------------- outfits

  /** Wear an outfit (persisted choice). Cancels any running parade. */
  setOutfit(id: OutfitId) {
    this.parade = null;
    this.greetLoop = false;
    this.outfitId = id;
    this.applyOutfit(id);
  }

  /** Load outfit models ahead of time so parade cuts never wait on a download. */
  preloadOutfits(ids: OutfitId[]): Promise<unknown> {
    return Promise.all(ids.map((id) => this.outfitProto(id)));
  }

  /**
   * The reference clip's effect: hold each look for 1 s, then hard-cut to the
   * next, while the pet keeps greeting. `onStep` reports the look on screen.
   */
  startParade(ids: OutfitId[], onStep?: (id: OutfitId) => void) {
    if (!ids.length) return;
    this.parade = { ids, index: 0, t: 0, onStep };
    this.applyOutfit(ids[0]);
    onStep?.(ids[0]);
    this.greetLoop = true;
    if (this.greetT < 0) this.greetT = 0;
  }

  /** End the parade and settle on `finalId` (the outfit to keep wearing). */
  stopParade(finalId: OutfitId) {
    this.setOutfit(finalId);
  }

  get isParading() {
    return this.parade !== null;
  }

  private outfitProto(id: OutfitId): Promise<Object3D | null> {
    const def = outfitDef(id);
    if (!def) return Promise.resolve(null);
    let p = this.outfitProtos.get(def.id);
    if (!p) {
      const url = outfitGlbUrl(def);
      p = (url ? loadModel(url) : Promise.resolve(null)).then((proto) => {
        this.resolvedProtos.set(def.id, proto);
        return proto;
      });
      this.outfitProtos.set(def.id, p);
    }
    return p;
  }

  /**
   * Swap the visible accessory. Synchronous when the model is already loaded
   * (always true during a parade), so a cut is one frame, as in the clip.
   */
  private applyOutfit(id: OutfitId) {
    const token = ++this.outfitToken;
    const def = outfitDef(id);
    if (!def || !this.anchors) {
      this.outfitSlot.clear();
      return;
    }
    const anchors = this.anchors;
    const place = (proto: Object3D | null) => {
      if (token !== this.outfitToken) return; // superseded by a newer swap
      this.outfitSlot.clear();
      if (!proto) return;
      const obj = proto.clone(true);
      fitAccessory(obj, def, anchors);
      this.outfitSlot.add(obj);
    };
    const ready = this.resolvedProtos.get(def.id);
    if (ready !== undefined) place(ready);
    else void this.outfitProto(id).then(place);
  }

  // --------------------------------------------------------------- greeting

  /**
   * A procedural hello in place of an arm wave (our pets have no skeleton):
   * anticipation squash, hop, two rocks leaning toward the viewer, settle.
   */
  greet() {
    this.greetT = 0;
  }

  /**
   * Pose the body for greeting time `g` (0..GREET_SECONDS), overriding the
   * idle hop. Faces the viewer throughout, like the reference's front-on wave.
   */
  private applyGreeting(g: number, dtSec: number) {
    let y = 0;
    let sy = 1;
    let rz = 0;
    let rx = 0;
    if (g < 0.15) {
      // Anticipation: squash down before the hop.
      sy = 1 - 0.14 * Math.sin(((g / 0.15) * Math.PI) / 2);
    } else if (g < 0.45) {
      // Hop, stretched at the top.
      const k = (g - 0.15) / 0.3;
      y = Math.sin(k * Math.PI) * 0.28;
      sy = 1 + 0.12 * Math.sin(k * Math.PI);
    } else if (g < 1.0) {
      // Two rocks side to side, leaning toward the viewer, fading in and out.
      const k = (g - 0.45) / 0.55;
      const env = Math.sin(k * Math.PI);
      rz = Math.sin(k * Math.PI * 4) * 0.3 * env;
      rx = 0.12 * env;
      y = Math.abs(Math.sin(k * Math.PI * 4)) * 0.04 * env;
    } else {
      // Settle with a small landing squash.
      const k = Math.min(1, (g - 1.0) / (GREET_SECONDS - 1.0));
      sy = 1 - 0.08 * Math.sin(k * Math.PI);
    }
    this.petBody.position.y = y;
    this.petBody.scale.set(2 - sy, sy, 1);
    this.petBody.rotation.z = rz;
    this.petBody.rotation.x = rx;
    this.petHolder.rotation.y *= 1 - Math.min(1, dtSec * 10);
  }

  private getProp(kind: PropKind): Object3D {
    const cacheKey = kind;
    let proto = this.propCache.get(cacheKey);
    if (!proto) {
      const holder = new Group();
      holder.add(buildPlaceholderProp(kind));
      const url = packItemGlbUrl(CHARACTER_PACK_KEY, PROP_ASSET_KEYS[kind]);
      if (url) {
        void loadModel(url).then((model) => {
          if (!model) return;
          const heights: Record<PropKind, number> = {
            poop: 0.34, bread: 0.4, candy: 0.36, skull: 0.4, tombstone: 1.0,
          };
          normalizeModel(model, heights[kind]);
          holder.clear();
          holder.add(model);
        });
      }
      proto = holder;
      this.propCache.set(cacheKey, proto);
    }
    return proto.clone(true);
  }

  // ------------------------------------------------------------------ state

  syncWorld(s: PetSnapshot) {
    // Poop piles
    while (this.poopGroup.children.length < s.poops) {
      const p = this.getProp("poop");
      const i = this.poopGroup.children.length;
      // Parked on the right of the LCD, clear of the pet's wander range and
      // inside the visible floor, spread in x and depth so all four read as
      // separate piles rather than one clump.
      p.position.set(0.86 + (i % 2) * 0.34, 0, -0.5 + Math.floor(i / 2) * 0.8);
      this.poopGroup.add(p);
    }
    while (this.poopGroup.children.length > s.poops) {
      this.poopGroup.remove(this.poopGroup.children[this.poopGroup.children.length - 1]);
    }

    // Sick skull
    if (s.sick && !this.skullHolder.children.length) {
      this.skullHolder.add(this.getProp("skull"));
    }
    if (!s.sick) this.skullHolder.clear();
    this.skullHolder.visible = s.sick && s.stage !== "dead";

    // Death
    const dead = s.stage === "dead";
    if (dead && !this.tombstoneHolder.children.length) {
      const t = this.getProp("tombstone");
      this.tombstoneHolder.add(t);
    }
    this.tombstoneHolder.visible = dead;
    this.petHolder.visible = !dead;
    if (dead) this.poopGroup.clear();

    // Lighting day/night
    const dark = s.asleep && !s.lightsOn;
    const bg = this.scene.background as Color;
    bg.lerp(dark ? this.bgDark : this.bgLit, 0.15);
    this.ambient.intensity += ((dark ? 0.12 : 0.85) - this.ambient.intensity) * 0.15;
    this.keyLight.intensity += ((dark ? 0.15 : 1.6) - this.keyLight.intensity) * 0.15;
  }

  /** Begin the eating animation (food appears in front of the pet). */
  startFeeding(snack: boolean) {
    this.foodHolder.clear();
    this.foodHolder.add(this.getProp(snack ? "candy" : "bread"));
    this.foodHolder.position.set(this.petHolder.position.x + 0.75 * this.facing, 0, 0.35);
    this.foodHolder.scale.setScalar(1);
    this.foodHolder.visible = true;
    this.feedingT = 0;
  }

  stopFeeding() {
    this.foodHolder.visible = false;
    this.feedingT = -1;
  }

  /** Mini-game: make the pet face left (-1), right (1) or forward (0). */
  setTurn(dir: -1 | 0 | 1) {
    this.targetTurn = dir;
  }

  centerPet() {
    this.petHolder.position.set(0, 0, 0);
  }

  // -------------------------------------------------------------- animation

  update(dtSec: number, s: PetSnapshot, opts: { wander: boolean; chubby: boolean }) {
    this.time += dtSec;
    const t = this.time;

    // Parade: hard cut to the next look every PARADE_STEP_SECONDS.
    if (this.parade) {
      const p = this.parade;
      p.t += dtSec;
      while (p.t >= PARADE_STEP_SECONDS) {
        p.t -= PARADE_STEP_SECONDS;
        p.index = (p.index + 1) % p.ids.length;
        const id = p.ids[p.index];
        this.applyOutfit(id);
        p.onStep?.(id);
      }
    }

    if (s.stage === "dead") return;

    const isEgg = s.stage === "egg";
    const sleeping = s.asleep;

    // Greeting clock (a sleeping pet never greets).
    if (sleeping) this.greetT = -1;
    const greeting = this.greetT >= 0;
    const g = this.greetT;
    if (greeting) {
      this.greetT += dtSec;
      if (this.greetT >= GREET_SECONDS) this.greetT = this.greetLoop ? 0 : -1;
    }
    this.petBody.rotation.x = 0;

    // Squash & stretch + hop
    if (isEgg) {
      // Egg wobble, ramping up as hatch approaches. A greeting is a big extra
      // wobble — an egg has nothing to hop with.
      const urgency = 1 + Math.min(1, (s.totalMin - s.stageStartMin) / 5) * 1.6;
      const hello = greeting ? Math.sin(g * Math.PI * 6) * 0.35 * (1 - g / GREET_SECONDS) : 0;
      this.petBody.rotation.z = Math.sin(t * 7 * urgency) * 0.12 * urgency * 0.6 + hello;
      this.petBody.position.y = Math.abs(Math.sin(t * 14)) * 0.015 * urgency;
      this.petHolder.position.x *= 0.9;
    } else if (sleeping) {
      this.petBody.rotation.z = Math.PI * 0.45;
      const breathe = 1 + Math.sin(t * 1.8) * 0.035;
      this.petBody.scale.set(breathe, 2 - breathe, 1);
      this.petBody.position.y = 0.05;
      this.petHolder.position.x *= 0.95;
      this.petHolder.rotation.y = 0;
    } else {
      this.petBody.rotation.z = 0;
      this.petBody.position.y = 0;

      const sulking = opts.chubby || s.sick || s.hungry === 0 || s.happy === 0;
      const hopSpeed = sulking ? 2.2 : 4.6;
      const hopAmp = sulking ? 0.05 : 0.16;
      this.hopPhase += dtSec * hopSpeed;
      const hop = Math.abs(Math.sin(this.hopPhase));
      this.petBody.position.y = hop * hopAmp;
      const squash = 1 - Math.cos(this.hopPhase * 2) * 0.06;
      this.petBody.scale.set(2 - squash, squash, 1);

      // Mini-game turning
      this.turn += (this.targetTurn - this.turn) * Math.min(1, dtSec * 8);
      this.petHolder.rotation.y = this.turn * 1.05;

      if (this.feedingT >= 0) {
        // Lean toward the food; food shrinks in bites (driven externally).
        this.petHolder.position.x += (this.foodHolder.position.x - 0.7 * this.facing - this.petHolder.position.x) * Math.min(1, dtSec * 4);
        this.petHolder.rotation.y = this.facing * 0.35;
        this.feedingT += dtSec;
        const bite = Math.max(0, 1 - Math.floor(this.feedingT / 0.55) * 0.34);
        this.foodHolder.scale.setScalar(Math.max(0.02, bite));
        this.foodHolder.visible = bite > 0.03;
      } else if (opts.wander && this.targetTurn === 0 && !greeting) {
        // Side-shuffle wander, kept clear of the poop corner on the right.
        const target = Math.sin(t * 0.33) * 0.45;
        const dx = target - this.petHolder.position.x;
        this.petHolder.position.x += dx * Math.min(1, dtSec * 1.2);
        if (Math.abs(dx) > 0.02) this.facing = dx > 0 ? 1 : -1;
        this.petHolder.rotation.y = this.facing * 0.22 * (sulking ? 0.4 : 1);
      }

      if (greeting && this.feedingT < 0) this.applyGreeting(g, dtSec);
    }

    // Skull bobs beside the pet, clamped so it never leaves the LCD.
    if (this.skullHolder.visible) {
      this.skullHolder.position.set(
        Math.max(-1.05, this.petHolder.position.x - 0.8),
        0.95 + Math.sin(t * 2.4) * 0.08,
        0.25,
      );
    }
  }
}
