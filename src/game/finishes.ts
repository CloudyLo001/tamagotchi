import {
  CanvasTexture,
  Color,
  Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  Object3D,
  PMREMGenerator,
  RepeatWrapping,
  Texture,
  Vector2,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/**
 * Surface finishes for the device exteriors (Tamagotchi shells and the Muse
 * Charm). A finish changes only how the surface reflects light (gloss,
 * sheen, sparkle, metal); each shell keeps its own artwork and colour.
 * No finish is emissive: nothing glows.
 */

export type FinishId = "classic" | "glossy" | "matte" | "pearl" | "glitter" | "brushed";

export interface Finish {
  id: FinishId;
  name: string;
  /** CSS background for the settings swatch. */
  swatch: string;
  /** Offered for the Charm? (Its classic look is already glossy.) */
  charm: boolean;
}

export const FINISHES: Finish[] = [
  { id: "classic", name: "Classic", swatch: "linear-gradient(135deg, #cfc6dc, #9d93ad)", charm: true },
  {
    id: "glossy", name: "Glossy", charm: false,
    swatch: "radial-gradient(circle at 30% 28%, #fff 0 12%, #a9a2b8 14%, #6f6880 100%)",
  },
  { id: "matte", name: "Matte", swatch: "#8f889c", charm: true },
  {
    id: "pearl", name: "Pearl", charm: true,
    swatch: "linear-gradient(135deg, #f6e9ff, #d8f3ff 35%, #ffe6f1 65%, #efe8d8)",
  },
  {
    id: "glitter", name: "Glitter", charm: true,
    swatch:
      "radial-gradient(circle at 25% 30%, #fff 0 6%, transparent 7%)," +
      "radial-gradient(circle at 70% 60%, #fff 0 5%, transparent 6%)," +
      "radial-gradient(circle at 45% 80%, #fff 0 4%, transparent 5%)," +
      "linear-gradient(135deg, #b8aecb, #7a7090)",
  },
  {
    id: "brushed", name: "Brushed metal", charm: true,
    swatch: "repeating-linear-gradient(90deg, #c9cbd1 0 2px, #a7a9b0 2px 4px, #d7d9de 4px 5px)",
  },
];

export function finishIds(device: "tama" | "charm"): FinishId[] {
  return FINISHES.filter((f) => device === "tama" || f.charm).map((f) => f.id);
}

// ------------------------------------------------------------------- shared

let studioEnv: Texture | null = null;

/** Neutral studio reflections, made once and shared by both devices. */
export function studioEnvironment(renderer: WebGLRenderer): Texture {
  if (!studioEnv) {
    const pmrem = new PMREMGenerator(renderer);
    studioEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }
  return studioEnv;
}

let flakes: Texture | null = null;

/**
 * Tiny randomly tilted flakes as a tangent-space normal map. Under a clear
 * coat each flake catches the light at its own angle, which is what reads as
 * glitter (reflection only; nothing emits light).
 */
function flakeNormals(): Texture {
  if (flakes) return flakes;
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgb(128,128,255)"; // flat
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 5200; i++) {
    const nx = (Math.random() * 2 - 1) * 0.75;
    const ny = (Math.random() * 2 - 1) * 0.75;
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    const r = Math.round((nx * 0.5 + 0.5) * 255);
    const gg = Math.round((ny * 0.5 + 0.5) * 255);
    const b = Math.round((nz * 0.5 + 0.5) * 255);
    g.fillStyle = `rgb(${r},${gg},${b})`;
    const s = 1 + Math.random() * 2;
    g.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  flakes = new CanvasTexture(c);
  flakes.colorSpace = NoColorSpace;
  flakes.wrapS = flakes.wrapT = RepeatWrapping;
  flakes.repeat.set(6, 6);
  return flakes;
}

let brushLines: Texture | null = null;

/**
 * Fine horizontal streaks as a roughness map, so brushed metal shows its
 * grain rather than just a smeared highlight.
 */
function brushedRoughness(): Texture {
  if (brushLines) return brushLines;
  const w = 16;
  const h = 512;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  for (let y = 0; y < h; y++) {
    const v = Math.round(120 + Math.random() * 110); // roughness ~0.47..0.9
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(0, y, w, 1);
  }
  brushLines = new CanvasTexture(c);
  brushLines.colorSpace = NoColorSpace;
  brushLines.wrapS = brushLines.wrapT = RepeatWrapping;
  brushLines.repeat.set(1, 3);
  return brushLines;
}

// ---------------------------------------------------------------- materials

/** What a finish is painted over: the device's own colour and detail. */
export interface FinishBase {
  map: Texture | null;
  color: Color;
  normalMap: Texture | null;
  normalScale: Vector2;
  side: Material["side"];
}

export function baseFrom(m: MeshStandardMaterial): FinishBase {
  return {
    map: m.map ?? null,
    color: m.color.clone(),
    normalMap: m.normalMap ?? null,
    normalScale: m.normalScale.clone(),
    side: m.side,
  };
}

/**
 * Build a material for a finish. `classic` is not handled here: each device
 * keeps its own classic material.
 *
 * Reflection strengths are kept low on purpose: the studio map is a bright
 * white room, and its fill light bleaches the shell artwork, while its light
 * panels are strong enough to still give crisp highlights at low strength.
 * A dark body (the Charm) has no colour to bleach and passes `envScale` > 1
 * so its finishes show.
 */
export function finishMaterial(
  finish: Exclude<FinishId, "classic">,
  base: FinishBase,
  env: Texture,
  envScale = 1,
) {
  const m = new MeshPhysicalMaterial({
    map: base.map,
    color: base.color,
    normalMap: base.normalMap,
    side: base.side,
    envMap: env,
    metalness: 0,
  });
  m.normalScale.copy(base.normalScale);
  switch (finish) {
    case "glossy":
      m.roughness = 0.4;
      m.clearcoat = 1;
      m.clearcoatRoughness = 0.05;
      m.envMapIntensity = 0.15;
      break;
    case "matte":
      m.roughness = 0.92;
      m.envMapIntensity = 0.05;
      break;
    case "pearl":
      // A thin iridescent film and a soft silky sheen at the edges; kept
      // gentle (stronger values bleach the artwork to pastel).
      m.roughness = 0.42;
      m.clearcoat = 0.6;
      m.clearcoatRoughness = 0.12;
      m.iridescence = 0.35;
      m.iridescenceIOR = 1.3;
      m.iridescenceThicknessRange = [250, 420];
      m.sheen = 0.12;
      m.sheenRoughness = 0.45;
      m.sheenColor = new Color(0xfff4fb);
      m.envMapIntensity = 0.15;
      break;
    case "glitter":
      // Flakes in the base layer; the original shape detail rides on the
      // smooth clear coat above them.
      m.normalMap = flakeNormals();
      m.normalScale.set(1, 1);
      m.clearcoatNormalMap = base.normalMap;
      m.clearcoatNormalScale.copy(base.normalScale);
      m.metalness = 0.55;
      m.roughness = 0.32;
      m.clearcoat = 1;
      m.clearcoatRoughness = 0.03;
      m.envMapIntensity = 0.3;
      break;
    case "brushed":
      m.metalness = 0.85;
      m.roughness = 1; // scaled by the streaked map
      m.roughnessMap = brushedRoughness();
      m.anisotropy = 0.85;
      m.envMapIntensity = 0.45;
      break;
  }
  m.envMapIntensity *= envScale;
  return m;
}

/**
 * Apply a finish to every mesh under `root`. The first call remembers each
 * mesh's own material, so switching back to `classic` restores it exactly.
 * A device can supply its own classic material (`classicOf`) and its own base
 * to paint finishes over (`baseOf`).
 */
export function applyFinish(
  root: Object3D,
  finish: FinishId,
  env: Texture,
  opts: {
    classicOf?: (original: MeshStandardMaterial) => Material;
    baseOf?: (original: MeshStandardMaterial, finish: FinishId) => FinishBase;
    envScale?: number;
    /** Device-specific adjustments after the recipe is built. */
    tweak?: (m: MeshPhysicalMaterial, finish: FinishId) => void;
  } = {},
) {
  const classicOf = opts.classicOf ?? ((m) => m);
  const baseOf = opts.baseOf ?? ((m) => baseFrom(m));
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const ud = mesh.userData as { originalMaterial?: MeshStandardMaterial; finishMaterial?: Material };
    ud.originalMaterial ??= mesh.material as MeshStandardMaterial;
    ud.finishMaterial?.dispose();
    const original = ud.originalMaterial;
    let next: Material;
    if (finish === "classic") {
      next = classicOf(original);
    } else {
      const m = finishMaterial(finish, baseOf(original, finish), env, opts.envScale ?? 1);
      opts.tweak?.(m, finish);
      next = m;
    }
    ud.finishMaterial = next === original ? undefined : next;
    mesh.material = next;
  });
}
