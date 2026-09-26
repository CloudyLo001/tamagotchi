import {
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Raycaster,
  RingGeometry,
  Texture,
  Vector2,
  Vector3,
} from "three";
import { loadModel, normalizeModel, packItemGlbUrl } from "../assets/registry";
import type { ShellId } from "../sim/save";
import { ShellTheme, shellTheme } from "./themes";
import { applyFinish, type FinishId } from "./finishes";

type ShellStyle = ShellTheme;

// Layout in normalized device space (device height = 1, centered at origin,
// front toward +Z). Calibrated against the generated shell renders.
const LAYOUT = {
  screenCenter: new Vector2(0, -0.028),
  screenSize: 0.35,
  buttonY: -0.368,
  buttonSpacing: 0.132,
  buttonRadius: 0.064,
  // Baked shell buttons protrude with faces tilted up-forward; match that.
  buttonTilt: new Vector3(0, 0.45, 0.9).normalize(),
};

export interface DeviceParts {
  /** Where the LCD plane should be attached (position/orientation applied). */
  placeScreen(mesh: Mesh): void;
}

/**
 * The egg-shaped handheld. Loads the mint shell for the chosen design and
 * falls back to a recolorable procedural shell so gameplay is never blocked.
 * Owns the three physical buttons (always our own meshes so they can visibly
 * depress) and the screen plane placement.
 */
export class DeviceShell {
  readonly group = new Group();
  private shellHolder = new Group();
  private buttonGroup = new Group();
  readonly buttons: Mesh[] = [];
  private buttonRest: Vector3[] = [];
  private buttonNormal: Vector3[] = [];
  private screenMesh: Mesh | null = null;
  private raycaster = new Raycaster();
  private loadToken = 0;
  private finish: FinishId = "classic";
  private env: Texture | null = null;

  constructor() {
    this.group.add(this.shellHolder, this.buttonGroup);
  }

  async setShell(id: ShellId, screen: Mesh) {
    const style = shellTheme(id);
    const token = ++this.loadToken;
    this.screenMesh = screen;

    // Start from the procedural fallback immediately.
    this.installShell(this.buildFallbackShell(style), style, true);

    const url = packItemGlbUrl(style.packKey, style.itemLabel);
    if (url) {
      const model = await loadModel(url);
      if (model && token === this.loadToken) {
        normalizeModel(model, 1);
        // normalizeModel rests the base on y=0 — recenter vertically.
        model.position.y -= 0.5;
        this.installShell(model, style, false);
      }
    }
  }

  /**
   * Surface finish of the shell (gloss, pearl, glitter...). Applies to the
   * shell body only, and is re-applied whenever the design changes; classic
   * restores the shell's own material.
   */
  setFinish(finish: FinishId, env: Texture) {
    this.finish = finish;
    this.env = env;
    this.shellHolder.children.forEach((c) => applyFinish(c, finish, env));
  }

  private installShell(shell: Object3D, style: ShellStyle, isFallback: boolean) {
    this.shellHolder.clear();
    if (this.env) applyFinish(shell, this.finish, this.env);
    this.shellHolder.add(shell);
    this.buildButtons(style);
    this.placeFrontFixtures(isFallback);
  }

  // -------------------------------------------------------------- fallback

  /** Egg profile radius at height y (device space, -0.5..0.5). */
  private eggRadiusAt(y: number): number {
    const ang = (y + 0.5) * Math.PI;
    return Math.sin(ang) * (0.36 + 0.075 * Math.cos(ang));
  }

  private buildFallbackShell(style: ShellStyle): Group {
    const g = new Group();
    // Egg profile via lathe
    const pts: Vector2[] = [];
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps; // 0 bottom .. 1 top
      pts.push(new Vector2(Math.max(0.001, this.eggRadiusAt(t - 0.5)), t - 0.5));
    }
    const body = new Mesh(
      new LatheGeometry(pts, 48),
      new MeshStandardMaterial({ color: style.bodyColor, roughness: 0.35, metalness: 0.05 }),
    );
    body.scale.z = 0.6; // flattened front-to-back
    g.add(body);

    // Bezel ring + recessed screen backing on the front
    const bezel = new Mesh(
      new RingGeometry(LAYOUT.screenSize * 0.52, LAYOUT.screenSize * 0.72, 8),
      new MeshStandardMaterial({ color: style.bezelColor, roughness: 0.4 }),
    );
    bezel.rotation.z = Math.PI / 8;
    const backing = new Mesh(
      new CylinderGeometry(LAYOUT.screenSize * 0.56, LAYOUT.screenSize * 0.56, 0.01, 4),
      new MeshStandardMaterial({ color: 0x6b7362, roughness: 0.9 }),
    );
    backing.rotation.x = Math.PI / 2;
    backing.rotation.y = Math.PI / 4;
    const frontZ = this.eggRadiusAt(LAYOUT.screenCenter.y) * 0.6;
    bezel.position.set(LAYOUT.screenCenter.x, LAYOUT.screenCenter.y, frontZ + 0.004);
    backing.position.set(LAYOUT.screenCenter.x, LAYOUT.screenCenter.y, frontZ - 0.002);
    g.add(bezel, backing);

    // Keychain loop
    const loop = new Mesh(
      new CapsuleGeometry(0.02, 0.05, 6, 10),
      new MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3, metalness: 0.6 }),
    );
    loop.position.set(0, 0.53, 0);
    g.add(loop);
    return g;
  }

  // --------------------------------------------------------------- fixtures

  /**
   * Raycast against the shell in DEVICE-LOCAL space (x/y on the front face,
   * looking toward -z) and return the local hit point + normal. Works even
   * while an outer pivot is animating, because the ray is transformed into
   * world space first and the hit transformed back.
   */
  private frontHit(
    target: Object3D,
    x: number,
    y: number,
  ): { point: Vector3; normal: Vector3 } | null {
    target.updateMatrixWorld(true);
    const origin = new Vector3(x, y, 5);
    const dir = new Vector3(0, 0, -1);
    // device.group local -> world
    this.group.updateMatrixWorld(true);
    origin.applyMatrix4(this.group.matrixWorld);
    dir.transformDirection(this.group.matrixWorld);
    this.raycaster.set(origin, dir);
    const hits = this.raycaster.intersectObject(target, true);
    if (!hits.length) return null;
    const hit = hits[0];
    const point = this.group.worldToLocal(hit.point.clone());
    let normal = new Vector3(0, 0, 1);
    if (hit.face) {
      normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      // world -> device local direction
      const inv = this.group.matrixWorld.clone().invert();
      normal.transformDirection(inv);
    }
    return { point, normal };
  }

  private buildButtons(style: ShellStyle) {
    this.buttonGroup.clear();
    this.buttons.length = 0;
    this.buttonRest.length = 0;
    this.buttonNormal.length = 0;
    const mat = new MeshStandardMaterial({ color: style.buttonColor, roughness: 0.35 });
    for (let i = 0; i < 3; i++) {
      const b = new Mesh(new CylinderGeometry(LAYOUT.buttonRadius, LAYOUT.buttonRadius * 1.08, 0.06, 24), mat);
      b.name = `button-${i}`;
      this.buttonGroup.add(b);
      this.buttons.push(b);
      this.buttonRest.push(new Vector3());
      this.buttonNormal.push(new Vector3(0, 0, 1));
    }
  }

  private placeFrontFixtures(isFallback: boolean) {
    // NOTE: assumes this.group itself stays at identity — any floating/tilt
    // animation must be applied to an outer pivot, not to device.group.
    const shell = this.shellHolder;
    shell.updateMatrixWorld(true);
    // Screen plane
    if (this.screenMesh) {
      const hit = this.frontHit(shell, LAYOUT.screenCenter.x, LAYOUT.screenCenter.y);
      this.screenMesh.position.set(
        LAYOUT.screenCenter.x,
        LAYOUT.screenCenter.y,
        (hit?.point.z ?? 0.2) + (isFallback ? 0.006 : 0.008),
      );
      this.screenMesh.scale.setScalar(LAYOUT.screenSize);
      if (this.screenMesh.parent !== this.group) this.group.add(this.screenMesh);
    }

    // Buttons, following the curved surface
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * LAYOUT.buttonSpacing;
      const y = LAYOUT.buttonY;
      const hit = this.frontHit(shell, x, y);
      const point = hit?.point ?? new Vector3(x, y, 0.15);
      const normal = LAYOUT.buttonTilt.clone();
      const b = this.buttons[i];
      b.position.copy(point).addScaledVector(normal, 0.01);
      b.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), normal);
      this.buttonRest[i].copy(b.position);
      this.buttonNormal[i].copy(normal);
    }
  }

  /** Visibly depress/release a button (0=A, 1=S, 2=D, left to right). */
  setButtonPressed(index: number, pressed: boolean) {
    const b = this.buttons[index];
    if (!b) return;
    b.position.copy(this.buttonRest[index]);
    if (pressed) b.position.addScaledVector(this.buttonNormal[index], -0.014);
  }

  /** Which button (if any) does this main-scene raycast hit? */
  buttonAt(raycaster: Raycaster): number | null {
    const hits = raycaster.intersectObjects(this.buttons, false);
    if (!hits.length) return null;
    return this.buttons.indexOf(hits[0].object as Mesh);
  }
}
