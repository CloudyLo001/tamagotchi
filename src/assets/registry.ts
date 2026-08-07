import type { Group, Object3D } from "three";
import { Box3, Vector3 } from "three";
import registry from "../../mint-assets.json";
import { createMintGltfLoader } from "./gltf-runtime";

// mint-assets.json is maintained by scripts/sync-mint-assets.mjs — never edit
// artifact records by hand.

interface ArtifactRecord {
  artifactId: string;
  role?: string;
  format?: string;
  filename?: string;
  localPath: string;
  loaderHint?: string;
  label?: string;
}

interface AssetRecord {
  artifacts: Record<string, ArtifactRecord & { label?: string }>;
}

const assets: Record<string, AssetRecord> = (registry as any).assets ?? {};

/** Convert a registry filesystem path (public/...) into a browser URL. */
function toUrl(localPath: string): string {
  const rel = localPath.replace(/^public\//, "/");
  return `${import.meta.env.BASE_URL.replace(/\/$/, "")}${rel.startsWith("/") ? rel : `/${rel}`}`;
}

/**
 * Browser URL of a single-file asset (image, audio) by registry key. Returns
 * null when the asset has not been synced, so callers can fall back.
 */
export function assetUrl(key: string, artifactId = "image_file"): string | null {
  const rec = assets[key];
  const art = rec?.artifacts?.[artifactId];
  return art ? toUrl(art.localPath) : null;
}

/**
 * Find the GLB URL for a labelled item inside a synced asset-pack record.
 * Pack items carry labels like "shell-lightning GLB" or "adult-mame GLB".
 * Returns null when the pack or item has not been synced yet — callers fall
 * back to procedural placeholders so gameplay is never blocked.
 */
export function packItemGlbUrl(packKey: string, itemLabel: string): string | null {
  const pack = assets[packKey];
  if (!pack) return null;
  for (const art of Object.values(pack.artifacts)) {
    if (art.format !== "glb") continue;
    const label = (art as any).label ?? art.filename ?? art.artifactId;
    if (
      label.toLowerCase().startsWith(`${itemLabel.toLowerCase()} `) ||
      label.toLowerCase() === itemLabel.toLowerCase() ||
      (art.filename ?? "").toLowerCase().startsWith(`${itemLabel.toLowerCase()}-`) ||
      art.artifactId.toLowerCase().includes(`:${itemLabel.toLowerCase()}`)
    ) {
      return toUrl(art.localPath);
    }
  }
  return null;
}

const gltfLoader = createMintGltfLoader();
const modelCache = new Map<string, Promise<Group | null>>();

/**
 * Load (and cache) a GLB by URL. Resolves null on failure so callers can use
 * their placeholder path; the first error is logged once.
 */
export function loadModel(url: string): Promise<Group | null> {
  let entry = modelCache.get(url);
  if (!entry) {
    entry = gltfLoader
      .loadAsync(url)
      .then((gltf) => gltf.scene)
      .catch((err) => {
        console.warn(`[assets] failed to load ${url}:`, err);
        return null;
      });
    modelCache.set(url, entry);
  }
  // Each caller gets its own clone so scenes stay independent.
  return entry.then((scene) => (scene ? (scene.clone(true) as Group) : null));
}

/** Normalize a model to a target height, resting on y=0, centered on x/z. */
export function normalizeModel(obj: Object3D, targetHeight: number) {
  const box = new Box3().setFromObject(obj);
  const size = new Vector3();
  box.getSize(size);
  const scale = size.y > 1e-6 ? targetHeight / size.y : 1;
  obj.scale.multiplyScalar(scale);
  const box2 = new Box3().setFromObject(obj);
  const center = new Vector3();
  box2.getCenter(center);
  obj.position.x -= center.x;
  obj.position.z -= center.z;
  obj.position.y -= box2.min.y;
}
