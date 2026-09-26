# Tama 3D — Gen 1 Virtual Pet

A faithful recreation of the original 1996 Gen 1 Tamagotchi, presented as a 3D
egg-shaped device whose LCD contains a living 3D pet. Built with Vite +
TypeScript + three.js; all 3D assets generated through the mint MCP pipeline.

> Fan project for personal/local use only — Tamagotchi is Bandai IP. Do not
> publish or distribute.

## Run

```bash
npm install
npm run dev      # dev server
npm run build    # typecheck + production bundle
npm run sync-assets -- --manifest <manifest.json> --key <key>   # mint asset sync
```

## Play

- **Landing page**: Press Start (new egg), Continue (live save), Muse Charm
  (a toy mode, see *Muse Charm* below), How to Play (in-game rules
  reference), Settings (shell design, egg color, sound, LCD effect, reset).
- **Buttons**: the device's three buttons are labelled `A` (select),
  `S` (confirm) and `D` (cancel) to match the keyboard keys that drive them.
  Icons on the LCD are also directly clickable. Drag the device to tilt it.
- **Icons** — top: Feed, Light, Game, Medicine · bottom: Toilet, Meter,
  Discipline, Attention (indicator).
- **Wardrobe & hello**: tap the pet on the screen to make it greet you; the
  👕 button dresses it up (see *Wardrobe* below).
- **Time**: 1 real minute = 1 in-game hour; a full day passes in 24 real
  minutes and ages the pet 1 Tamagotchi year. The pet sleeps 9 PM–9 AM
  (game time) and needs its light turned off.

## Gen 1 rules implemented

- Hungry/Happy hearts (4 each) with stage-based decay; meal vs snack
  (snacks overfeed and can cause sickness), weight with per-stage minimums.
- "Left or Right" mini-game: 5 rounds, 3+ wins = success (+1 happy, −1 lb).
- Poop on a post-meal timer; 4 uncleaned piles cause sickness. Medicine
  sometimes needs two doses. Untreated sickness kills.
- Discipline calls (pet cries for nothing) — scold to fill the discipline
  meter; wrong responses or ignoring count as discipline mistakes.
- Care mistakes from ignored attention calls (15 game-minute window).
- Care-driven evolution: Egg → Babytchi → Marutchi → Tamatchi/Kuchitamatchi →
  one of six adults per the classic growth chart, plus the secret Oyajitchi
  path (Maskutchi, never disciplined, flawless adult care, age 10).
- Death by old age (10–14), sickness, or neglect → tombstone screen → new egg.
- localStorage persistence with wall-clock offline catch-up (capped at two
  game weeks) — the pet lives while the tab is closed.

## Architecture

- `src/sim/` — pure simulation, no three.js: `data.ts` (all tuning + the
  evolution chart as data tables), `pet.ts` (state machine; 1 tick = 1 game
  minute), `clock.ts` (fixed-timestep driver), `save.ts` (persistence +
  catch-up), `rng.ts` (seeded PRNG).
- `src/game/` — presentation: `device.ts` (mint shell + procedural fallback,
  physical buttons), `screen.ts` + `lcd.ts` (render-to-texture LCD with
  pixel-quantization shader), `petScene.ts` (3D pet world, procedural
  squash-and-stretch animation, placeholder blobs until mint models load),
  `hud.ts` (icon row, meter pages, menus), `controller.ts` (icon menu state
  machine + input), `minigame.ts`, `audio.ts` (WebAudio square-wave beeps).
- `src/game/backdrop.ts` — the generated pastel scene behind the device
  (cover-fitted plane + parallax drift) and the soft halo that grounds the
  floating shell. The same artwork backs the landing page.
- `mint-assets.json` — durable mint asset registry, maintained by
  `scripts/sync-mint-assets.mjs`; files sync into `public/assets/mint/`.
  Every GLB loads through the shared Draco-capable loader
  (`src/assets/gltf-runtime.ts`). Placeholder fallbacks mean gameplay never
  blocks on asset availability.

## Mint assets

Registry keys, all synced with `scripts/sync-mint-assets.mjs`:

| Key | Contents |
|---|---|
| `shells` | 3 device shells (lightning / dream / candy) |
| `shells2` | 4 more shells (ocean / galaxy / bloom / arcade) |
| `characters` | 17 items — egg, baby, child, both teens, six adults, the secret adult, and the poop / bread / candy / skull / tombstone props |
| `backdrop`, `backdrop-ocean`, `backdrop-galaxy`, `backdrop-meadow`, `backdrop-bedroom` | 5 scene images, used behind the device and on the title screen |
| `outfit-party-hat`, `outfit-crown`, `outfit-wizard-hat`, `outfit-flower-crown`, `outfit-round-glasses`, `outfit-bow-tie` | Wardrobe accessories, one Mint-optimised (Draco) GLB plus preview thumbnail each |
| `charm-device` | The Muse Charm device body (optimised GLB) |
| `muse-mascot` | The rigged mascot plus eight animation clips (Idle, Idle 3, Big Wave Hello, Roll Dodge, Knock Down, Dead, Jumping Jacks, Run Fast 3 in place). Roll Dodge is synced but no longer used |
| `muse-mascot-extra` | Victory Fist Pump, Big Heart Gesture, Head Hold in Pain, Shrug |
| `muse-mascot-getup` | Stand Up1, the get-up clip (Arise was rejected by Mint's animation provider) |

### Wardrobe

The 👕 button opens a wardrobe. While it's open the pet **parades every
outfit, one second each with a hard cut**, then keeps whichever you pick.
Outfits are defined in `src/game/outfits.ts`, and one accessory model fits
every pet:

- `measureAnchors` in `src/game/petScene.ts` raycasts each installed model
  to find the head top, head width, face and neck.
- Pets whose eyes or neck sit in unusual places carry `eyeY`, `neckY` or
  `headDrop` overrides in `CHARACTERS` (`src/sim/data.ts`).
- Outfits are looked up by Mint's stable artifact IDs (`optimized_glb`,
  `preview_image`), not filenames, so a regenerated item can come back
  under a new name without breaking anything.

The pets have no skeleton, so instead of an arm wave they **greet** with
a procedural hop and rock. That plays when you tap the pet, after
hatching or evolving, and throughout the parade.

### Muse Charm

A second device on the title screen: a toy with no care stats, so a running
pet stays paused while it's out. Its screen is a clean full-colour render of
the mascot, and your mouse (or finger) plays with it:

| Gesture | Reaction |
|---|---|
| Tap the mascot | Big Wave Hello |
| Double-tap | Big Heart Gesture |
| Press and hold | Shrug |
| Soft flick (anywhere on the screen) | Head Hold in Pain, in place |
| Hard flick | Knock Down, Stand Up1, Victory Fist Pump, then runs back |
| 3 hard flicks in a row | Dead, then gets up and cheers |
| Rub back and forth | Jumping jacks while you rub; the last jump lands, then a Big Heart |
| Hold and draw circles | Walks for slow circles, runs (Run Fast 3) for fast ones. Randomly, every few seconds, either travels a loop the same way round as your finger or goes on the spot at home (a loop only switches to on-the-spot once it's back home). Heads back to the middle when you stop |
| Leave it 20 s | Waves for attention; Idle 3 or a shrug now and then |

Every animation plays to the end: gestures made while the mascot is busy
are ignored, and it can't be turned by hand.

- `src/charm/charmMode.ts` holds the device (re-skinned as glossy black
  lacquer with a clear coat over a studio reflection map), the screen (render-to-texture placed flush
  on the Charm's face by raycasts, under an additive glass layer whose
  reflections move as the device tilts) and pointer routing.
- `src/charm/gestures.ts` turns pointer paths on the screen into tap,
  double-tap, hold, flick, rub and circles. Circles are told apart from a
  rub by the path being round (both axes spread) and consistently turning
  one way; their speed comes from the last half-second so walk/run follows
  you quickly.
- `src/charm/charmWorld.ts` is the mascot's state machine: knockback, run
  home, get up, turn to face you.
- `src/charm/mascot.ts` loads the rig, then streams the clips in the
  background. Horizontal root motion is removed (pinned to the rig's rest
  pose) so the game, not the clip, decides where a flick sends it.

Each clip GLB carries its own copy of the mesh (about 2.7 MB apiece, about
36 MB in total). They load only when the Charm is opened, and the mascot
appears as soon as the rig and Idle are in.

**Shell finishes** (Settings → Shell finish / Charm finish) change only how
the device surface reflects light, keeping each shell's artwork: Classic,
Glossy (Tamagotchi only; the Charm's classic is already glossy), Matte,
Pearl, Glitter and Brushed metal. They live in `src/game/finishes.ts` as
`MeshPhysicalMaterial` recipes over a shared studio reflection map. Glitter
uses a generated flake normal map under a clear coat and brushed metal a
streaked roughness map. None is emissive. Reflections are kept weak on the
Tamagotchi (the bright studio map bleaches its artwork otherwise) and boosted
on the black Charm.

Shell and scene options are declared in `src/game/themes.ts`. The plain
**White** and **Black** scenes have no artwork: the device gets a soft drop
shadow on white and a faint glow on black (a shadow can't show on black), in
place of the pastel halo. The settings
pickers build themselves from those tables, so adding a look means adding one
row plus a synced registry key — a theme whose asset is missing still works and
falls back to procedural colours.

Pack items are resolved by label prefix (`packItemGlbUrl("characters", "adult-mame")`),
so re-syncing a pack with new file hashes needs no code changes.
#   t a m a g o t c h i 
 
 