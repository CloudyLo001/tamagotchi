import "./style.css";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import { CHARACTERS } from "./sim/data";
import { PetSim } from "./sim/pet";
import {
  Settings,
  clearPetSave,
  loadPetSave,
  loadSettings,
  newPet,
  resumePet,
  savePet,
  saveSettings,
} from "./sim/save";
import { assetUrl } from "./assets/registry";
import { Beeper } from "./game/audio";
import { Backdrop } from "./game/backdrop";
import { BACKDROP_THEMES, SHELL_THEMES, backdropTheme } from "./game/themes";
import { DeviceShell } from "./game/device";
import { GameController, InputBinder } from "./game/controller";
import { ScreenHud } from "./game/hud";
import { PetWorld } from "./game/petScene";
import { ScreenRenderer } from "./game/screen";

// ----------------------------------------------------------------- three.js

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;

const scene = new Scene();
scene.background = new Color(0xf3e6ff);

const camera = new PerspectiveCamera(32, 1, 0.1, 20);
camera.position.set(0, 0.04, 2.35);
camera.lookAt(0, 0, 0);

scene.add(new AmbientLight(0xffffff, 0.9));
const key = new DirectionalLight(0xfff2df, 2.2);
key.position.set(1.6, 2.2, 2.4);
scene.add(key);
const rim = new DirectionalLight(0xc8e4ff, 1.1);
rim.position.set(-2, 0.6, -1.5);
scene.add(rim);

const backdrop = new Backdrop();
scene.add(backdrop.mesh, backdrop.halo);

// Pivot owns all floating/tilt animation; device.group must stay at identity
// so its internal raycast-based fixture placement remains valid.
const pivot = new Group();
scene.add(pivot);

const device = new DeviceShell();
pivot.add(device.group);

const world = new PetWorld();
const hud = new ScreenHud();
const screenRenderer = new ScreenRenderer(hud, 1024);
const beeper = new Beeper();

// ------------------------------------------------------------------ settings

let settings: Settings = loadSettings();

function applySettings() {
  beeper.enabled = settings.sound;
  screenRenderer.setLcdEffect(settings.lcd);
  void device.setShell(settings.shell, screenRenderer.mesh);
  backdrop.setTheme(settings.backdrop);

  // The title screen wears the same art as the 3D scene, so the two read as
  // one world. Falls back to the theme's gradient when the image is missing.
  const theme = backdropTheme(settings.backdrop);
  const url = assetUrl(theme.key);
  const landing = document.getElementById("landing");
  if (landing) {
    landing.style.backgroundImage = url ? `url("${url}")` : theme.gradient;
  }
}

// -------------------------------------------------------------------- state

let controller: GameController | null = null;

function startNewPet() {
  clearPetSave();
  attachController(newPet(settings.eggColor));
}

function continuePet(): boolean {
  const stored = loadPetSave();
  if (!stored) return false;
  const { sim, highlights } = resumePet(stored);
  savePet(sim);
  attachController(sim);
  const died = highlights.find((e) => e.kind === "died");
  if (died) controller!.announce(["OH NO…", "Something happened", "while you were away"]);
  else if (highlights.some((e) => e.kind === "evolved")) controller!.announce(["WELCOME BACK!", "Your pet grew!"]);
  return true;
}

function attachController(sim: PetSim) {
  controller = new GameController(
    sim,
    world,
    hud,
    device,
    beeper,
    () => settings.eggColor,
    onDeathAcknowledged,
  );
}

function onDeathAcknowledged() {
  clearPetSave();
  controller = null;
  showLanding();
}

// ------------------------------------------------------------------ landing

const landingEl = document.getElementById("landing")!;
const settingsEl = document.getElementById("settings")!;
const hudEl = document.getElementById("hud")!;
const btnStart = document.getElementById("btn-start") as HTMLButtonElement;
const btnContinue = document.getElementById("btn-continue") as HTMLButtonElement;
const btnSettings = document.getElementById("btn-settings") as HTMLButtonElement;
const howtoEl = document.getElementById("howto")!;
const btnHowto = document.getElementById("btn-howto") as HTMLButtonElement;
const btnCloseHowto = document.getElementById("btn-close-howto") as HTMLButtonElement;
const btnCloseSettings = document.getElementById("btn-close-settings") as HTMLButtonElement;
const btnSettingsGame = document.getElementById("btn-settings-game") as HTMLButtonElement;
const btnReset = document.getElementById("btn-reset") as HTMLButtonElement;
const btnHome = document.getElementById("btn-home") as HTMLButtonElement;

function refreshContinueButton() {
  const stored = loadPetSave();
  if (stored && stored.snapshot.stage !== "dead") {
    const def = CHARACTERS[stored.snapshot.character];
    btnContinue.textContent = `Continue — ${def.name}, age ${stored.snapshot.ageDays}`;
    btnContinue.classList.remove("hidden");
  } else if (stored) {
    btnContinue.textContent = "Continue";
    btnContinue.classList.remove("hidden");
  } else {
    btnContinue.classList.add("hidden");
  }
}

function showLanding() {
  refreshContinueButton();
  landingEl.classList.remove("hidden");
  requestAnimationFrame(() => landingEl.classList.remove("fading"));
  hudEl.classList.add("hidden");
}

function enterGame() {
  landingEl.classList.add("hidden");
  hudEl.classList.remove("hidden");
}

btnStart.addEventListener("click", () => {
  beeper.confirm();
  startNewPet();
  enterGame();
});

btnContinue.addEventListener("click", () => {
  beeper.confirm();
  if (continuePet()) enterGame();
  else refreshContinueButton();
});

btnHome.addEventListener("click", () => {
  if (controller) savePet(controller.sim);
  controller = null;
  showLanding();
});

// ----------------------------------------------------------------- settings

const shellPicker = document.getElementById("shell-picker")!;
const backdropPicker = document.getElementById("backdrop-picker")!;

/** Build a swatch button. Themes whose asset is missing are still selectable —
 *  they fall back to procedural colours rather than disappearing. */
function buildSwatch(name: string, style: string, onPick: () => void) {
  const b = document.createElement("button");
  b.className = "swatch";
  b.innerHTML = `<span class="swatch-dot" style="background:${style}"></span><span>${name}</span>`;
  b.addEventListener("click", () => {
    onPick();
    saveSettings(settings);
    syncSettingsUi();
    applySettings();
    beeper.blip();
  });
  return b;
}

for (const t of SHELL_THEMES) {
  const swatch = buildSwatch(
    t.name,
    `linear-gradient(135deg, ${t.swatch[0]} 0 50%, ${t.swatch[1]} 50% 100%)`,
    () => { settings.shell = t.id; },
  );
  swatch.dataset.shell = t.id;
  shellPicker.appendChild(swatch);
}

for (const t of BACKDROP_THEMES) {
  const swatch = buildSwatch(t.name, t.gradient, () => { settings.backdrop = t.id; });
  swatch.dataset.backdrop = t.id;
  backdropPicker.appendChild(swatch);
}

function syncSettingsUi() {
  shellPicker.querySelectorAll<HTMLButtonElement>("[data-shell]").forEach((b) => {
    b.classList.toggle("selected", b.dataset.shell === settings.shell);
  });
  backdropPicker.querySelectorAll<HTMLButtonElement>("[data-backdrop]").forEach((b) => {
    b.classList.toggle("selected", b.dataset.backdrop === settings.backdrop);
  });
  document.querySelectorAll<HTMLButtonElement>("#egg-picker [data-egg]").forEach((b) => {
    b.classList.toggle("selected", b.dataset.egg === settings.eggColor);
  });
  (document.getElementById("toggle-sound") as HTMLButtonElement).textContent = settings.sound ? "On 🔊" : "Off 🔇";
  (document.getElementById("toggle-lcd") as HTMLButtonElement).textContent = settings.lcd ? "On" : "Off";
}

function openSettings() {
  beeper.blip();
  syncSettingsUi();
  settingsEl.classList.remove("hidden");
  settingsEl.querySelector(".panel")!.scrollTop = 0;
}

btnHowto.addEventListener("click", () => {
  beeper.blip();
  howtoEl.classList.remove("hidden");
  // Reset only after it is displayed — scrollTop does not stick on a
  // display:none element, which would reopen the page where it was left.
  howtoEl.querySelector(".panel")!.scrollTop = 0;
});

btnCloseHowto.addEventListener("click", () => {
  beeper.confirm();
  howtoEl.classList.add("hidden");
});

// Escape closes whichever overlay is open.
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!howtoEl.classList.contains("hidden")) howtoEl.classList.add("hidden");
  else if (!settingsEl.classList.contains("hidden")) settingsEl.classList.add("hidden");
});

// Clicking the dimmed area outside a panel closes it. The listener sits on the
// overlay and checks the target is the overlay itself, so clicks that bubble up
// from inside the panel (buttons, scrollbar, text) never dismiss it.
for (const overlay of [settingsEl, howtoEl]) {
  overlay.addEventListener("pointerdown", (e) => {
    if (e.target !== overlay) return;
    overlay.classList.add("hidden");
    beeper.cancel();
  });
}

// Settings are reachable from the title screen and mid-game (gear in the HUD).
// Changing a look never touches the pet — the simulation keeps running behind
// the panel, exactly as it would on a real device.
btnSettings.addEventListener("click", openSettings);
btnSettingsGame.addEventListener("click", openSettings);

btnCloseSettings.addEventListener("click", () => {
  beeper.confirm();
  settingsEl.classList.add("hidden");
});

document.querySelectorAll<HTMLButtonElement>("#egg-picker [data-egg]").forEach((b) => {
  b.addEventListener("click", () => {
    settings.eggColor = b.dataset.egg as Settings["eggColor"];
    saveSettings(settings);
    syncSettingsUi();
    beeper.blip();
  });
});

document.getElementById("toggle-sound")!.addEventListener("click", () => {
  settings.sound = !settings.sound;
  saveSettings(settings);
  syncSettingsUi();
  applySettings();
  beeper.blip();
});

document.getElementById("toggle-lcd")!.addEventListener("click", () => {
  settings.lcd = !settings.lcd;
  saveSettings(settings);
  syncSettingsUi();
  applySettings();
  beeper.blip();
});

btnReset.addEventListener("click", () => {
  if (!confirm("Reset your pet? This cannot be undone.")) return;
  clearPetSave();
  const wasPlaying = controller !== null;
  controller = null;
  refreshContinueButton();
  beeper.cancel();
  // Resetting mid-game leaves nothing to render, so close settings and return
  // to the title screen where a new egg can be started.
  if (wasPlaying) {
    settingsEl.classList.add("hidden");
    showLanding();
  }
});

// -------------------------------------------------------------------- input

let tiltX = 0;
let tiltY = 0;

new InputBinder(
  canvas,
  camera,
  device,
  () => screenRenderer.mesh,
  () => controller,
  {
    onDrag: (dx, dy) => {
      tiltY += dx * 0.005;
      tiltX += dy * 0.004;
      tiltY = Math.max(-0.55, Math.min(0.55, tiltY));
      tiltX = Math.max(-0.3, Math.min(0.3, tiltX));
    },
  },
);

// --------------------------------------------------------------------- loop

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Keep the whole device visible in portrait and landscape alike.
  camera.fov = w < h ? 40 : 32;
  camera.updateProjectionMatrix();
  backdrop.resize(camera);
}
window.addEventListener("resize", resize);
resize();

let lastTime = performance.now();

function tickAndRender(dtMs: number, nowMs: number) {
  const t = nowMs / 1000;

  // Gentle idle bob + spring-back drag tilt
  pivot.position.y = Math.sin(t * 1.1) * 0.018;
  tiltY *= 0.97;
  tiltX *= 0.97;
  pivot.rotation.y = Math.sin(t * 0.6) * 0.06 + tiltY;
  pivot.rotation.x = tiltX;
  backdrop.update(tiltX, tiltY, t);

  if (controller) {
    controller.update(dtMs);
    screenRenderer.render(renderer, world, hud);
  }
  renderer.render(scene, camera);
}

function frame(now: number) {
  const dtMs = now - lastTime;
  lastTime = now;
  tickAndRender(dtMs, now);
  requestAnimationFrame(frame);
}

if (import.meta.env.DEV) {
  // Dev-only hook for headless smoke tests (manual frame stepping).
  (window as any).__tama = {
    step: (dtMs: number) => {
      lastTime = performance.now();
      tickAndRender(dtMs, lastTime);
    },
    get controller() {
      return controller;
    },
    canvas,
  };
}

// Persist on tab close/hide so offline catch-up starts from the right moment.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && controller) savePet(controller.sim);
});
window.addEventListener("beforeunload", () => {
  if (controller) savePet(controller.sim);
});

applySettings();
showLanding();
requestAnimationFrame(frame);
