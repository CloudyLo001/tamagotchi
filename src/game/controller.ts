import { Camera, Raycaster, Vector2 } from "three";
import { CHARACTERS, STAGE_TUNING } from "../sim/data";
import { PetSim, SimEvent } from "../sim/pet";
import { SimClock } from "../sim/clock";
import { savePet } from "../sim/save";
import { Beeper } from "./audio";
import { DeviceShell } from "./device";
import { ScreenHud, HudView } from "./hud";
import { PetWorld } from "./petScene";
import { MiniGameState, guess, newMiniGame, updateMiniGame } from "./minigame";

type Mode =
  | { kind: "idle" }
  | { kind: "feedMenu"; sel: 0 | 1 }
  | { kind: "feeding"; t: number }
  | { kind: "meter"; page: number }
  | { kind: "game"; state: MiniGameState; finishT: number }
  | { kind: "evolving"; t: number; name: string }
  | { kind: "message"; lines: string[]; t: number; duration: number };

/**
 * Orchestrates sim <-> presentation: icon menu, A/S/D buttons, screen modes,
 * sounds, and periodic saving.
 */
export class GameController {
  private clock = new SimClock();
  private mode: Mode = { kind: "idle" };
  private selectedIcon: number | null = null;
  private saveTimer = 0;

  constructor(
    public sim: PetSim,
    private world: PetWorld,
    private hud: ScreenHud,
    private device: DeviceShell,
    private beeper: Beeper,
    private eggColor: () => "white" | "pink",
    private onDeathAcknowledged: () => void,
  ) {
    this.world.setCharacter(sim.s.character, eggColor());
    this.world.syncWorld(sim.s);
  }

  // ------------------------------------------------------------------ input

  /** Button index left-to-right: 0=A (select) 1=S (confirm) 2=D (cancel). */
  pressButton(index: number) {
    this.device.setButtonPressed(index, true);
    if (index === 0) this.buttonA();
    else if (index === 1) this.buttonB();
    else this.buttonC();
  }

  releaseButton(index: number) {
    this.device.setButtonPressed(index, false);
  }

  clickIcon(index: number) {
    if (this.sim.s.stage === "dead") return;
    if (this.mode.kind === "evolving" || this.mode.kind === "feeding") return;
    this.selectedIcon = index;
    this.beeper.blip();
    this.activateSelected();
  }

  private buttonA() {
    const m = this.mode;
    switch (m.kind) {
      case "idle": {
        if (this.sim.s.stage === "dead") return;
        this.beeper.blip();
        this.selectedIcon = this.selectedIcon === null ? 0 : (this.selectedIcon + 1) % 8;
        break;
      }
      case "feedMenu":
        this.beeper.blip();
        m.sel = m.sel === 0 ? 1 : 0;
        break;
      case "meter":
        this.beeper.blip();
        m.page = (m.page + 1) % 4;
        break;
      case "game":
        if (m.state.phase === "prompt") {
          guess(m.state, -1);
          this.revealTurn(m.state);
        }
        break;
      default:
        break;
    }
  }

  private buttonB() {
    const m = this.mode;
    if (this.sim.s.stage === "dead") {
      this.beeper.confirm();
      this.onDeathAcknowledged();
      return;
    }
    switch (m.kind) {
      case "idle":
        this.activateSelected();
        break;
      case "feedMenu":
        this.executeFeed(m.sel === 1);
        break;
      case "meter":
        this.beeper.blip();
        m.page = (m.page + 1) % 4;
        break;
      case "game":
        if (m.state.phase === "prompt") {
          guess(m.state, 1);
          this.revealTurn(m.state);
        }
        break;
      default:
        break;
    }
  }

  private buttonC() {
    const m = this.mode;
    switch (m.kind) {
      case "idle":
        if (this.selectedIcon !== null) {
          this.beeper.cancel();
          this.selectedIcon = null;
        }
        break;
      case "feedMenu":
      case "meter":
      case "message":
        this.beeper.cancel();
        this.toIdle();
        break;
      case "game":
        this.beeper.cancel();
        this.world.setTurn(0);
        this.toIdle();
        break;
      default:
        break;
    }
  }

  private revealTurn(state: MiniGameState) {
    this.world.setTurn(state.petDir);
    if (state.lastWin) this.beeper.win();
    else this.beeper.lose();
  }

  // ------------------------------------------------------------------ icons

  private activateSelected() {
    if (this.selectedIcon === null) return;
    const s = this.sim.s;
    if (s.stage === "egg") {
      this.beeper.refuse();
      return;
    }
    switch (this.selectedIcon) {
      case 0: // Feed
        if (!this.sim.isAwake || s.sick) return this.refuse();
        this.beeper.confirm();
        this.mode = { kind: "feedMenu", sel: 0 };
        break;
      case 1: // Light
        this.beeper.confirm();
        this.sim.toggleLight();
        break;
      case 2: // Game
        if (!this.sim.gameAllowed()) return this.refuse();
        this.beeper.confirm();
        this.world.centerPet();
        this.mode = { kind: "game", state: newMiniGame(), finishT: 0 };
        break;
      case 3: { // Medicine
        if (!s.sick) return this.refuse();
        const events = this.sim.giveMedicine();
        this.beeper.confirm();
        if (events.some((e) => e.kind === "cured")) {
          this.beeper.win();
          this.showMessage(["FEELING", "BETTER!"]);
        } else {
          this.showMessage(["NEEDS MORE", "MEDICINE…"]);
        }
        break;
      }
      case 4: // Toilet
        if (s.poops === 0) return this.refuse();
        this.beeper.clean();
        this.sim.cleanToilet();
        this.world.syncWorld(s);
        break;
      case 5: // Meter
        this.beeper.confirm();
        this.mode = { kind: "meter", page: 0 };
        break;
      case 6: { // Discipline
        const wasCall = s.attention?.type === "discipline";
        this.sim.discipline();
        if (wasCall) {
          this.beeper.confirm();
          this.showMessage(["SCOLDED!", `TRAINING ${s.discipline}%`]);
        } else {
          this.beeper.refuse();
        }
        break;
      }
      case 7: // Attention indicator — not an action
        this.refuse();
        break;
    }
  }

  private refuse() {
    this.beeper.refuse();
  }

  private executeFeed(snack: boolean) {
    const events = snack ? this.sim.feedSnack() : this.sim.feedMeal();
    if (events.some((e) => e.kind === "refusedFood")) {
      this.beeper.refuse();
      this.showMessage(["NOT HUNGRY!"]);
      return;
    }
    if (events.some((e) => e.kind === "ate")) {
      this.beeper.eat();
      this.world.startFeeding(snack);
      this.mode = { kind: "feeding", t: 0 };
    }
    this.handleEvents(events);
  }

  private showMessage(lines: string[], duration = 2.2) {
    this.mode = { kind: "message", lines, t: 0, duration };
  }

  /** External announcement (e.g. welcome-back after offline catch-up). */
  announce(lines: string[]) {
    this.showMessage(lines, 4.5);
  }

  private toIdle() {
    this.mode = { kind: "idle" };
  }

  // ------------------------------------------------------------------- loop

  update(dtMs: number) {
    const events = this.clock.advance(this.sim, dtMs);
    this.handleEvents(events);

    const dtSec = Math.min(0.1, dtMs / 1000);
    const m = this.mode;

    if (m.kind === "feeding") {
      m.t += dtSec;
      if (m.t > 1.9) {
        this.world.stopFeeding();
        this.toIdle();
      }
    } else if (m.kind === "game") {
      const finishedNow = updateMiniGame(m.state, dtSec);
      if (m.state.phase === "prompt") this.world.setTurn(0);
      if (finishedNow) {
        this.handleEvents(this.sim.finishGame(m.state.won));
        if (m.state.won) this.beeper.evolveJingle();
        else this.beeper.lose();
      }
      if (m.state.phase === "done") {
        m.finishT += dtSec;
        this.world.setTurn(0);
        if (m.finishT > 1.6) {
          this.showMessage([m.state.won ? "YOU WIN!" : "YOU LOSE…", `${m.state.wins}/5 rounds`]);
        }
      }
    } else if (m.kind === "evolving") {
      m.t += dtSec;
      if (m.t > 2.6) this.toIdle();
    } else if (m.kind === "message") {
      m.t += dtSec;
      if (m.t > m.duration) this.toIdle();
    }

    // Keep world in sync
    this.world.setCharacter(this.sim.s.character, this.eggColor());
    this.world.syncWorld(this.sim.s);
    const stage = this.sim.s.stage;
    const chubby =
      stage !== "egg" && stage !== "dead" && this.sim.s.weight >= STAGE_TUNING[stage].chubbyWeight;
    this.world.update(dtSec, this.sim.s, {
      wander: this.mode.kind === "idle" && !this.sim.s.asleep,
      chubby,
    });

    // Periodic save
    this.saveTimer += dtSec;
    if (this.saveTimer > 5) {
      this.saveTimer = 0;
      savePet(this.sim);
    }

    this.hud.draw(this.hudView());
  }

  private handleEvents(events: SimEvent[]) {
    for (const e of events) {
      switch (e.kind) {
        case "attention":
          this.beeper.attention();
          break;
        case "hatched":
          this.beeper.hatch();
          this.mode = { kind: "evolving", t: 0.6, name: CHARACTERS[this.sim.s.character].name };
          break;
        case "evolved":
          this.beeper.evolveJingle();
          this.mode = { kind: "evolving", t: 0, name: CHARACTERS[e.to].name };
          this.world.centerPet();
          break;
        case "died":
          this.beeper.deathChime();
          this.selectedIcon = null;
          this.toIdle();
          savePet(this.sim);
          break;
        case "fellAsleep":
          this.beeper.sleepCue();
          if (this.mode.kind !== "idle" && this.mode.kind !== "evolving") this.toIdle();
          break;
        case "wokeUp":
          this.beeper.blip();
          break;
        case "pooped":
          this.beeper.blip();
          break;
        default:
          break;
      }
    }
  }

  private hudView(): HudView {
    const s = this.sim.s;
    const m = this.mode;
    let mode: HudView["mode"];
    switch (m.kind) {
      case "feedMenu":
        mode = { kind: "feedMenu", sel: m.sel };
        break;
      case "meter":
        mode = { kind: "meter", page: m.page };
        break;
      case "game":
        mode = {
          kind: "game",
          round: m.state.round,
          wins: m.state.wins,
          prompt: m.state.phase === "prompt",
          lastWin: m.state.lastWin,
        };
        break;
      case "evolving": {
        // Two white pulses, then reveal
        const t = m.t;
        const flash = t < 1.4 ? Math.abs(Math.sin(t * Math.PI * 2.2)) : Math.max(0, 1 - (t - 1.4) * 2);
        mode = { kind: "evolving", flash, name: m.name };
        break;
      }
      case "message":
        mode = { kind: "message", lines: m.lines };
        break;
      default:
        mode = { kind: "idle" };
    }

    const h = Math.floor(s.minuteOfDay / 60);
    const min = s.minuteOfDay % 60;
    return {
      selectedIcon: this.selectedIcon,
      attentionLit: s.attention !== null,
      mode,
      snapshot: s,
      timeText: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`,
    };
  }
}

// ---------------------------------------------------------------- pointer/kb

/**
 * Wires pointer + keyboard to the controller: physical button clicks, direct
 * icon clicks on the screen plane, and drag-to-tilt on the shell.
 */
export class InputBinder {
  private raycaster = new Raycaster();
  private ndc = new Vector2();
  private keyDown = new Set<string>();

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: Camera,
    private device: DeviceShell,
    private screenMeshProvider: () => import("three").Mesh,
    private controller: () => GameController | null,
    private drag: { onDrag: (dx: number, dy: number) => void },
  ) {
    canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  private buttonHeld: number | null = null;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  private setNdc(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private onPointerDown = (e: PointerEvent) => {
    const ctrl = this.controller();
    if (!ctrl) return;
    this.setNdc(e);
    this.raycaster.setFromCamera(this.ndc, this.camera);

    // Physical buttons first
    const btn = this.device.buttonAt(this.raycaster);
    if (btn !== null) {
      this.buttonHeld = btn;
      ctrl.pressButton(btn);
      return;
    }

    // Screen icons
    const screen = this.screenMeshProvider();
    const hits = this.raycaster.intersectObject(screen, false);
    if (hits.length && hits[0].uv) {
      const icon = ScreenHud.iconAtUv(hits[0].uv.x, hits[0].uv.y);
      if (icon !== null) {
        ctrl.clickIcon(icon);
        return;
      }
      return; // clicking mid-screen does nothing
    }

    // Otherwise: drag to tilt
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    window.addEventListener("pointermove", this.onPointerMove);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.drag.onDrag(e.clientX - this.lastX, e.clientY - this.lastY);
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onPointerUp = () => {
    if (this.buttonHeld !== null) {
      this.controller()?.releaseButton(this.buttonHeld);
      this.buttonHeld = null;
    }
    this.dragging = false;
    window.removeEventListener("pointermove", this.onPointerMove);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const ctrl = this.controller();
    if (!ctrl) return;
    const map: Record<string, number> = { KeyA: 0, KeyS: 1, KeyD: 2 };
    const idx = map[e.code];
    if (idx === undefined || this.keyDown.has(e.code)) return;
    this.keyDown.add(e.code);
    ctrl.pressButton(idx);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const map: Record<string, number> = { KeyA: 0, KeyS: 1, KeyD: 2 };
    const idx = map[e.code];
    if (idx === undefined) return;
    this.keyDown.delete(e.code);
    this.controller()?.releaseButton(idx);
  };
}
