# Build Prompt — Tamagotchi (Gen 1) Virtual Pet in 3D

Build a browser-based Tamagotchi virtual pet game in **three.js**, using the **mint MCP** and the **mint-threejs-skills** skill for 3D asset generation. Recreate the original 1996 Gen 1 Tamagotchi game logic faithfully, but present it as a 3D egg-shaped device whose screen contains a living 3D pet. Scaffold the project exactly like the sibling projects in this repo (`../snorlax`, `../flappybird`): standalone Vite + TypeScript app, `mint-assets.json` registry, assets synced to `public/assets/mint/` via the `sync-assets` script from mint-threejs-skills.

---

## 1. Core design decisions (locked)

| Decision | Choice |
|---|---|
| Presentation | **3D device + 3D pet.** A mint-generated egg-shaped Tamagotchi shell fills the viewport; the pet is a 3D model living *inside the screen*, rendered via render-to-texture onto the screen mesh with a subtle LCD pixelation shader for retro feel. |
| Game logic | **Full Gen 1**: hunger/happy hearts, meal vs snack, weight, discipline, poop, sickness, sleep/lights, mini-game, attention icon, care-mistake-driven evolution, death. |
| Time scale | **Accelerated: 1 real minute = 1 in-game hour** (1 in-game day = 24 real minutes = 1 Tamagotchi year). Full egg-to-adult in one long sitting. |
| Persistence | **localStorage** — full sim state + wall-clock timestamp. On reload, fast-forward the simulation to catch up (pet may have pooped, gotten sick, or died while away). |
| Evolution | **Classic care-based lines** — everyone starts as an egg; care quality decides the character. |
| Entry | **Landing page** with Press Start, Continue (if a save exists), and Settings. |
| Settings | Shell design (3 variants below), egg color variant (white-spotted / pink-spotted — cosmetic), sound on/off. Changeable any time; shell swap doesn't reset the pet. |
| Input | **Mouse/touch** on the device's three physical buttons + direct icon clicks; keyboard `A`/`S`/`D` mirrors buttons A/B/C. |
| IP note | Tamagotchi is Bandai IP — personal/local use only, do not publish or distribute. |

---

## 2. Tech stack & project scaffold

- Vite + TypeScript + **three.js** (match versions in `../snorlax/package.json`), standalone project in this folder.
- **mint MCP + mint-threejs-skills** for all 3D assets; track them in `mint-assets.json`, sync with the skill's `sync-mint-assets.mjs` script (`npm run sync-assets`).
- Fixed-timestep simulation loop (game clock) decoupled from the render loop.
- Modular systems: `SimClock`, `PetState` (state machine + stats), `Evolution` (data-driven growth chart), `DeviceShell`, `ScreenRenderer` (render-to-texture + LCD shader), `IconMenu`, `Input`, `SaveSystem`, `Audio`. The growth chart and stage timings live in data tables, not code branches.

---

## 3. Presentation — device & screen

- **Device shell** (mint-generated, 3 design variants selectable in settings, matching the reference screenshots):
  1. **Lightning** — light-blue egg covered in yellow/pink cartoon lightning bolts and starbursts, magenta screen bezel, three yellow buttons.
  2. **Dream** — pastel-pink egg with clouds, rainbows and stars, purple bezel and lavender buttons.
  3. **Candy** — white egg with a swirl of yellow/orange/pink/purple/blue candy stripes, yellow buttons.
  Fallback: one neutral shell model recolored per-variant in three.js so gameplay is never blocked.
- Shell floats center-screen against a soft background; gentle idle bob + slight orbit tilt on drag (no full free orbit needed).
- **Screen**: a second scene (pet + props: food, poop, scale, tombstone…) rendered to a `WebGLRenderTarget` and mapped onto the screen mesh. Apply a light LCD effect (pixel quantization + faint grid + greenish-cream tint) so the 3D pet still reads "Tamagotchi". Keep the effect subtle and toggleable.
- **Icon row**: the classic 8 icons drawn around the screen on the bezel — top: **Feed, Light, Game, Medicine**; bottom: **Toilet, Meter, Discipline, Attention**. Attention icon lights up when the pet calls.
- **Buttons**: A = cycle icon selection, B = confirm/execute, C = cancel/back. Physical 3D buttons that visibly depress on click/keypress.

---

## 4. Pet characters (mint-generated)

Generate the Gen 1 cast as a consistent set of chunky, minimal, low-poly 3D characters (mint asset pack generation is ideal). No rigging — animate procedurally (hop, squash-and-stretch, side-shuffle, sleep breathing), which matches the original's bouncy pixel spirit.

| Stage | Characters |
|---|---|
| Egg | Spotted egg (wobbles, hatches) |
| Baby | Babytchi |
| Child | Marutchi |
| Teen | Tamatchi (good care) · Kuchitamatchi (poor care) |
| Adult | Mametchi · Ginjirotchi · Maskutchi · Kuchipatchi · Nyorotchi · Tarakotchi |
| Secret | Oyajitchi (Bill) |
| Extras | Poop pile, food (bread + candy), skull (sick), tombstone/angel |

Fallback: primitive placeholder blobs per character (distinct colors/shapes) so gameplay is never blocked on asset generation.

---

## 5. Game clock & life cycle

- 1 real min = 1 game hour; 24 real min = 1 game day = +1 year of age.
- **Stage timings** (game time): Egg hatches after ~5 game-min (~5 real sec of wobble — scale for drama). Baby → Child after ~1 game-hour. Child → Teen at age 2. Teen → Adult at age 4–5. Adults can die of old age from ~age 10 (random 10–14).
- **Sleep**: pet sleeps 9 PM–9 AM game time (12 real minutes). It calls for lights-off at bedtime; leaving the light on = 1 care mistake. Waking hours are when all care happens.
- **Offline catch-up**: on load, simulate elapsed real time through the same rules (capped so a week away = death of old age/neglect, handled gracefully with the tombstone screen).

---

## 6. Gen 1 care mechanics

- **Hearts**: Hungry (4) and Happy (4), each decaying on a game-hour timescale. Empty meter → attention call.
- **Feed**: Meal (bread) fills 1 hungry heart, +1 lb; refusing when full. Snack (candy) fills 1 happy heart, +2 lb — overuse causes sickness and can kill a child/teen.
- **Weight**: visible on the Meter screen; min per stage; overweight pet sulks; mini-game wins −1 lb.
- **Mini-game** ("Left or Right"): guess which way the pet turns, 5 rounds, 3+ wins = success, +1 happy heart.
- **Poop**: appears on a timer after meals; clean via Toilet icon. 4 uncleaned poops → sickness.
- **Sickness**: skull icon appears (no attention beep — you must notice). Medicine icon cures (sometimes needs 2 doses). Untreated sickness for too long → death.
- **Discipline**: occasionally the pet calls for attention while both meters are non-empty and it wants *nothing* — the correct response is the Discipline (scold) icon, +25% discipline meter. Feeding/playing instead, or ignoring it, = 1 discipline mistake.
- **Care mistakes**: an attention call (empty hearts or bedtime lights) ignored for ~15 game-minutes = 1 care mistake. Cumulative counters drive evolution.
- **Death**: old age, untreated sickness, or extreme neglect → death animation, tombstone/angel screen showing final age and character, then offer a new egg (back to landing page "Start").

---

## 7. Evolution chart (data-driven)

Teen fork — child-stage care: ≤2 care mistakes → **Tamatchi**; else → **Kuchitamatchi**.

Adult — cumulative care + discipline mistakes across child + teen stages:

| From Tamatchi | Condition |
|---|---|
| **Mametchi** | 0–2 care mistakes, discipline 100%, 0 discipline mistakes |
| **Ginjirotchi** | 0–2 care mistakes, 1 discipline mistake |
| **Maskutchi** | 0–2 care mistakes, 2+ discipline mistakes |

| From either teen | Condition |
|---|---|
| **Kuchipatchi** | 3+ care mistakes, 0–1 discipline mistakes |
| **Nyorotchi** | 3+ care mistakes, 2–3 discipline mistakes |
| **Tarakotchi** | 3+ care mistakes, 4+ discipline mistakes |

**Secret — Oyajitchi (Bill)**: reach Maskutchi having never disciplined (0%), then give near-perfect care; transforms around age 10.

Evolution plays a flash/morph moment on the screen. The whole chart is one data table so tuning is trivial.

---

## 8. Landing page & settings

- **Landing page** (HTML/CSS overlay, retro-toy aesthetic echoing the shell designs — bold rounded logo, starbursts, chunky buttons): title, **Press Start** (new egg), **Continue** (only if a live save exists, shows current character + age), **Settings**.
- **Settings panel**: shell design (3 variants with preview), egg color (cosmetic), sound toggle, LCD-effect toggle, and a **Reset pet** (with confirm). Settings persist in localStorage independently of the pet save.
- Pressing Start transitions (zoom/fade) from the landing page into the device view with the egg wobbling.

---

## 9. Sound

- Authentic piezo-style **beeps synthesized with WebAudio** (square wave): menu blips, attention call, evolution jingle, death chime — no assets needed.
- Optional: one short mint-generated chiptune loop for the landing page. Mute toggle persists.

---

## 10. Deliverables & acceptance

1. Landing page loads with Start/Continue/Settings; settings change shell design + egg variant and persist.
2. Start → 3D device with chosen shell; egg wobbles and hatches into Babytchi; full icon menu works via buttons A/B/C (mouse + keyboard).
3. All 8 icon functions work: feed (meal/snack), light, game (playable left/right), medicine, toilet, meter (hearts/age/weight/discipline pages), discipline, attention indicator.
4. Hearts decay, poop appears and causes sickness at 4, snacks overfeed, sleep at 9 PM requires lights off, care/discipline mistakes are counted.
5. Pet evolves Babytchi → Marutchi → teen → adult per the chart above based on actual play quality; death → tombstone → new egg loop works.
6. Reload restores the pet and fast-forwards elapsed time correctly.
7. `npm run dev` runs it; `npm run build` typechecks and bundles; mint assets tracked in `mint-assets.json` with placeholder fallbacks.

---

## 11. Explicitly deferred

Gen 2 characters/mini-game, multiple concurrent pets, achievements/gallery of discovered characters, mobile PWA packaging, shell customization beyond the 3 designs, sound packs.
