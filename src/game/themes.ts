import type { ShellId, BackdropId } from "../sim/save";

/**
 * Every selectable look lives here. Adding a shell or backdrop means adding one
 * row plus the matching registry key — the settings UI builds itself from these
 * tables, and unsynced entries are hidden automatically.
 */

export interface ShellTheme {
  id: ShellId;
  name: string;
  /** Asset-pack item label, e.g. "shell-lightning". */
  itemLabel: string;
  /** Registry key of the pack holding this shell. */
  packKey: string;
  /** Fallback colours if the GLB is unavailable. */
  bodyColor: number;
  bezelColor: number;
  buttonColor: number;
  /** Two colours for the settings swatch. */
  swatch: [string, string];
}

export const SHELL_THEMES: ShellTheme[] = [
  {
    id: "lightning", name: "Lightning", itemLabel: "shell-lightning", packKey: "shells",
    bodyColor: 0x9adcff, bezelColor: 0xd8399b, buttonColor: 0xffd23b, swatch: ["#9adcff", "#ffd23b"],
  },
  {
    id: "dream", name: "Dream", itemLabel: "shell-dream", packKey: "shells",
    bodyColor: 0xffc7de, bezelColor: 0x9b6fd4, buttonColor: 0xcdb8f2, swatch: ["#ffc7de", "#cdb8f2"],
  },
  {
    id: "candy", name: "Candy", itemLabel: "shell-candy", packKey: "shells",
    bodyColor: 0xfff6ee, bezelColor: 0xffd23b, buttonColor: 0xffd23b, swatch: ["#fff6ee", "#ff9ec4"],
  },
  {
    id: "ocean", name: "Ocean", itemLabel: "shell-ocean", packKey: "shells2",
    bodyColor: 0x62d4d0, bezelColor: 0x2f7fb5, buttonColor: 0x9df0d2, swatch: ["#62d4d0", "#9df0d2"],
  },
  {
    id: "galaxy", name: "Galaxy", itemLabel: "shell-galaxy", packKey: "shells2",
    bodyColor: 0x4b3b8f, bezelColor: 0x3fd0e6, buttonColor: 0xff5fa8, swatch: ["#4b3b8f", "#ff5fa8"],
  },
  {
    id: "bloom", name: "Bloom", itemLabel: "shell-bloom", packKey: "shells2",
    bodyColor: 0xaee7b8, bezelColor: 0xffe066, buttonColor: 0xff8f9c, swatch: ["#aee7b8", "#ff8f9c"],
  },
  {
    id: "arcade", name: "Arcade", itemLabel: "shell-arcade", packKey: "shells2",
    bodyColor: 0x23202b, bezelColor: 0x4dff9e, buttonColor: 0xff7a29, swatch: ["#23202b", "#4dff9e"],
  },
];

export interface BackdropTheme {
  id: BackdropId;
  name: string;
  /** Registry key of the synced image. */
  key: string;
  /** Fallback colour before/without the image. */
  fallback: number;
  /** CSS gradient used on the landing page and settings swatch. */
  gradient: string;
  /**
   * A solid studio colour with no artwork. The device gets a soft drop shadow
   * instead of the pastel halo, like a product shot.
   */
  plain?: boolean;
}

export const BACKDROP_THEMES: BackdropTheme[] = [
  {
    id: "rainbow", name: "Rainbow", key: "backdrop", fallback: 0xe8dcff,
    gradient: "linear-gradient(160deg, #ffe3f4 0%, #e6d5ff 55%, #cfeaff 100%)",
  },
  {
    id: "ocean", name: "Ocean", key: "backdrop-ocean", fallback: 0x9fe4e8,
    gradient: "linear-gradient(160deg, #bff3f0 0%, #6fd0dd 55%, #2f8fb5 100%)",
  },
  {
    id: "galaxy", name: "Galaxy", key: "backdrop-galaxy", fallback: 0x3a2f66,
    gradient: "linear-gradient(160deg, #4b3b8f 0%, #2a2350 55%, #120f26 100%)",
  },
  {
    id: "meadow", name: "Meadow", key: "backdrop-meadow", fallback: 0xd4edb0,
    gradient: "linear-gradient(160deg, #eaf7c4 0%, #b6e08a 55%, #7fc45f 100%)",
  },
  {
    id: "bedroom", name: "Bedroom", key: "backdrop-bedroom", fallback: 0xf3e0d2,
    gradient: "linear-gradient(160deg, #fdeee2 0%, #f3d6cf 55%, #d9b9b0 100%)",
  },
  {
    id: "white", name: "White", key: "", fallback: 0xffffff, plain: true,
    gradient: "linear-gradient(#ffffff, #ffffff)",
  },
  {
    id: "black", name: "Black", key: "", fallback: 0x000000, plain: true,
    gradient: "linear-gradient(#000000, #000000)",
  },
];

export function shellTheme(id: ShellId): ShellTheme {
  return SHELL_THEMES.find((t) => t.id === id) ?? SHELL_THEMES[0];
}

export function backdropTheme(id: BackdropId): BackdropTheme {
  return BACKDROP_THEMES.find((t) => t.id === id) ?? BACKDROP_THEMES[0];
}
