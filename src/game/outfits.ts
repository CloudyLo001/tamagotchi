import { assetUrl } from "../assets/registry";
import type { OutfitId } from "../sim/save";

/**
 * Wearable accessories. Like themes.ts, this table drives both the wardrobe UI
 * and the 3D fitting — adding an outfit means one row plus a synced pack item.
 *
 * Fitting is relative to each pet's measured head (see PetWorld anchors), so
 * one accessory model fits every character without per-pet authoring.
 */

export type OutfitSlot = "head" | "face" | "neck";

export interface OutfitDef {
  id: Exclude<OutfitId, "none">;
  name: string;
  slot: OutfitSlot;
  /** Asset-pack item label, e.g. "party-hat". */
  itemLabel: string;
  /** Accessory width as a fraction of the pet's measured head width. */
  fitWidth: number;
  /**
   * Head items: how far the base sinks into the head, as a fraction of head
   * width, so hats sit on the crown instead of hovering above it.
   */
  sink: number;
}

/**
 * Each outfit is synced as its own model asset (registry key "outfit-<label>")
 * so the web-optimised GLB can be imported per item.
 */
const outfitKey = (def: OutfitDef) => `outfit-${def.itemLabel}`;

export const OUTFITS: OutfitDef[] = [
  { id: "party-hat",     name: "Party hat",     slot: "head", itemLabel: "party-hat",     fitWidth: 0.55, sink: 0.06 },
  { id: "crown",         name: "Crown",         slot: "head", itemLabel: "crown",         fitWidth: 0.72, sink: 0.1 },
  { id: "wizard-hat",    name: "Wizard hat",    slot: "head", itemLabel: "wizard-hat",    fitWidth: 1.05, sink: 0.12 },
  { id: "flower-crown",  name: "Flower crown",  slot: "head", itemLabel: "flower-crown",  fitWidth: 0.95, sink: 0.14 },
  { id: "round-glasses", name: "Glasses",       slot: "face", itemLabel: "round-glasses", fitWidth: 0.82, sink: 0 },
  { id: "bow-tie",       name: "Bow tie",       slot: "neck", itemLabel: "bow-tie",       fitWidth: 0.5,  sink: 0 },
];

export function outfitDef(id: OutfitId): OutfitDef | null {
  return OUTFITS.find((o) => o.id === id) ?? null;
}

// Looked up by Mint's stable artifact IDs, not filenames: a regenerated item
// can come back with a different name (the wizard hat did) under the same key.
export function outfitGlbUrl(def: OutfitDef): string | null {
  return assetUrl(outfitKey(def), "optimized_glb");
}

export function outfitThumbUrl(def: OutfitDef): string | null {
  return assetUrl(outfitKey(def), "preview_image");
}

/** Outfits whose model is actually synced — unsynced rows are hidden. */
export function availableOutfits(): OutfitDef[] {
  return OUTFITS.filter((o) => outfitGlbUrl(o) !== null);
}
