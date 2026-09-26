import {
  AdditiveBlending,
  Box3,
  BoxGeometry,
  Camera,
  Color,
  Group,
  LinearFilter,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Raycaster,
  Shape,
  ShapeGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
  type Texture,
} from "three";
import { assetUrl, loadModel, normalizeModel } from "../assets/registry";
import { applyFinish, type FinishBase, type FinishId, studioEnvironment } from "../game/finishes";
import { CharmWorld } from "./charmWorld";
import { GestureRecognizer } from "./gestures";

/** Screen rectangle on the Charm's face, as fractions of the device height. */
const SCREEN = { size: 0.65, cx: 0.0, cy: 0.0, radius: 0.2 };

/** Rounded square with 0..1 UVs, matching the Charm's glass. */
function roundedScreenGeometry(radius: number) {
  const s = new Shape();
  const h = 0.5;
  const r = radius;
  s.moveTo(-h + r, -h);
  s.lineTo(h - r, -h);
  s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r);
  s.quadraticCurveTo(h, h, h - r, h);
  s.lineTo(-h + r, h);
  s.quadraticCurveTo(-h, h, -h, h - r);
  s.lineTo(-h, -h + r);
  s.quadraticCurveTo(-h, -h, -h + r, -h);
  const g = new ShapeGeometry(s, 12);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) + 0.5, pos.getY(i) + 0.5);
  return g;
}

/**
 * Clean, full-colour OLED panel (no LCD pixel filter) seen through curved
 * glass: a bright rim where the glass meets the bezel, lit from the top left,
 * slight darkening toward the edges, and a soft diagonal glare. The moving
 * reflections come from a separate glass layer on top (see `glassMaterial`).
 */
function oledMaterial(map: WebGLRenderTarget["texture"], radius: number) {
  return new ShaderMaterial({
    uniforms: { map: { value: map }, radius: { value: radius } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float radius;
      varying vec2 vUv;
      // Signed distance to the rounded screen outline (negative inside).
      float sdRound(vec2 p, float r) {
        vec2 q = abs(p) - vec2(0.5) + r;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }
      void main() {
        vec3 col = texture2D(map, vUv).rgb; // linear: the sRGB target decodes on read
        vec2 p = vUv - 0.5;
        float d = sdRound(p, radius);
        // curved glass: a little darker toward the edges
        col *= mix(1.0, 0.8, smoothstep(-0.1, 0.0, d));
        // bright glass rim, strongest on the top left where the light is
        float lit = clamp(dot(normalize(p + 1e-5), normalize(vec2(-0.6, 0.8))), 0.0, 1.0);
        float rim = smoothstep(-0.02, 0.0, d);
        col += vec3(0.5) * rim * (0.25 + 0.75 * lit);
        // soft diagonal glare band across the upper left
        float band = smoothstep(0.16, 0.0, abs((p.x + p.y) + 0.22));
        col += vec3(0.05) * band * smoothstep(0.0, 0.3, -d);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * A second, additive layer over the screen: black clear-coated glass, so the
 * only thing it adds is the studio reflection, which slides across the glass
 * as the device tilts.
 */
function glassMaterial(env: Texture) {
  return new MeshPhysicalMaterial({
    color: 0x000000,
    metalness: 0,
    roughness: 0.05,
    envMap: env,
    envMapIntensity: 0.55,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
}

/** Plain black: what every finish is painted over on the Charm. */
const CHARM_BLACK = 0x0a0a0c;
/** Brushed metal needs some colour to reflect, so it becomes graphite. */
const CHARM_GRAPHITE = 0x3a3b40;

/**
 * The Charm's classic body: glossy black lacquer with a soft clear coat. The
 * model's own colour and normal textures (which read as brushed, hammered
 * metal) are deliberately dropped.
 */
function charmClassic(src: MeshStandardMaterial, env: Texture) {
  return new MeshPhysicalMaterial({
    color: CHARM_BLACK,
    metalness: 0,
    roughness: 0.5,
    // Soft, dimmer reflections: a mirror-sharp coat over the curved rim
    // reflects the whole studio and reads as chrome, not black plastic.
    clearcoat: 1,
    clearcoatRoughness: 0.14,
    envMap: env,
    envMapIntensity: 0.5,
    side: src.side, // the dish is single-surface; keep it double-sided
  });
}

function charmBase(src: MeshStandardMaterial, finish: FinishId): FinishBase {
  return {
    map: null,
    color: new Color(finish === "brushed" ? CHARM_GRAPHITE : CHARM_BLACK),
    normalMap: null,
    normalScale: new Vector2(1, 1),
    side: src.side,
  };
}

/**
 * The Muse Charm: device model, its screen (render-to-texture of CharmWorld)
 * and mouse gestures on that screen. Created once and reused across visits.
 */
export class CharmMode {
  readonly group = new Group();
  readonly world = new CharmWorld();
  private shell = new Group();
  private screen: Mesh;
  private glass: Mesh;
  private env: Texture | null = null;
  private finish: FinishId = "classic";
  private target = new WebGLRenderTarget(1024, 1024);
  private gestures: GestureRecognizer;
  private raycaster = new Raycaster();
  private ndc = new Vector2();
  private loaded = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private pointerOnScreen = false;
  private lastUv = new Vector2();
  private time = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: Camera,
    private renderer: WebGLRenderer,
    private onTilt: (dx: number, dy: number) => void,
  ) {
    this.target.texture.colorSpace = SRGBColorSpace;
    this.target.texture.minFilter = LinearFilter;
    const face = roundedScreenGeometry(SCREEN.radius);
    this.screen = new Mesh(face, oledMaterial(this.target.texture, SCREEN.radius));
    this.screen.name = "charm-screen";
    this.glass = new Mesh(face);
    this.glass.visible = false; // until the environment map exists
    this.group.add(this.shell, this.screen, this.glass);
    this.group.visible = false;

    this.gestures = new GestureRecognizer({
      tap: () => this.world.tap(),
      doubleTap: () => this.world.doubleTap(),
      hold: () => this.world.hold(),
      flick: (dx, dy, speed, hard) => this.world.flick(dx, dy, speed, hard),
      petting: (on) => this.world.petting(on),
      circle: (on, tps) => this.world.circle(on, tps),
      hitsMascot: (u, v) => this.world.hitsMascot(u, v),
    });
  }

  get active() {
    return this.group.visible;
  }

  /** Load device + mascot on first use; later visits are instant. */
  async enter() {
    this.group.visible = true;
    if (this.loaded) return;
    this.loaded = true;
    await Promise.all([this.loadShell(), this.world.load()]);
  }

  exit() {
    this.group.visible = false;
    this.world.petting(false);
  }

  /** Surface finish of the Charm's body (classic = glossy black). */
  setFinish(finish: FinishId) {
    this.finish = finish;
    const body = this.shell.children[0];
    if (body) this.paint(body);
  }

  private paint(body: Object3D) {
    const env = this.environment();
    applyFinish(body, this.finish, env, {
      classicOf: (src) => charmClassic(src, env),
      baseOf: charmBase,
      // Black has no colour to bleach; it needs strong reflections to show.
      envScale: 4,
      tweak: (m, finish) => {
        if (finish !== "pearl") return;
        // Strong reflections turn a pearl coat on black into chrome. Instead:
        // softer reflections and a much stronger iridescent film, for a dark
        // pearly shimmer.
        m.envMapIntensity = 0.35;
        m.iridescence = 1;
        m.iridescenceThicknessRange = [200, 650];
        m.sheen = 0.35;
        m.sheenColor.set(0xe9dcff);
      },
    });
  }

  /** Studio reflections for the body and the glass (shared with the Tamagotchi). */
  private environment(): Texture {
    if (!this.env) {
      this.env = studioEnvironment(this.renderer);
      this.glass.material = glassMaterial(this.env);
      this.glass.visible = true;
    }
    return this.env;
  }

  private async loadShell() {
    this.installShell(this.fallbackShell());
    const url = assetUrl("charm-device", "optimized_glb");
    if (!url) return;
    const model = await loadModel(url);
    if (!model) return;
    normalizeModel(model, 1);
    model.position.y -= 0.5;
    this.installShell(model);
  }

  /** Plain dark rounded body if the model is unavailable. */
  private fallbackShell(): Object3D {
    const body = new Mesh(
      new BoxGeometry(0.95, 0.95, 0.22),
      new MeshStandardMaterial({ color: 0x18181c, roughness: 0.35, metalness: 0.2 }),
    );
    return body;
  }

  /** Put the screen on the front surface of whatever shell is installed. */
  private installShell(shell: Object3D) {
    this.paint(shell);
    this.shell.clear();
    this.shell.add(shell);
    this.shell.updateMatrixWorld(true);
    const box = new Box3().setFromObject(this.shell);
    const size = box.getSize(new Vector3());
    const h = size.y;
    // The face is a shallow dish, so a plane at the centre depth would be
    // hidden by the rising walls. Sample the surface across the screen's
    // footprint and sit the glass in front of its most forward point.
    const rc = new Raycaster();
    const half = (SCREEN.size * h) / 2;
    let z = -Infinity;
    for (let i = 0; i <= 8; i++) {
      for (let j = 0; j <= 8; j++) {
        const x = SCREEN.cx * h + half * (i / 4 - 1);
        const y = SCREEN.cy * h + half * (j / 4 - 1);
        rc.set(new Vector3(x, y, box.max.z + 1), new Vector3(0, 0, -1));
        const hit = rc.intersectObject(this.shell, true)[0];
        if (hit) z = Math.max(z, hit.point.z);
      }
    }
    if (!Number.isFinite(z)) z = box.max.z;
    this.screen.position.set(SCREEN.cx * h, SCREEN.cy * h, z + 0.003);
    this.screen.scale.setScalar(SCREEN.size * h);
    this.glass.position.copy(this.screen.position).setZ(this.screen.position.z + 0.002);
    this.glass.scale.copy(this.screen.scale);
  }

  // ------------------------------------------------------------------ input

  private screenUv(clientX: number, clientY: number): Vector2 | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.screen, false)[0];
    return hit?.uv ? hit.uv.clone() : null;
  }

  pointerDown(e: PointerEvent) {
    if (!this.active) return;
    const uv = this.screenUv(e.clientX, e.clientY);
    if (uv && this.world.isReady) {
      this.pointerOnScreen = true;
      this.lastUv.copy(uv);
      this.gestures.pointerDown(uv.x, uv.y, performance.now() / 1000);
    } else {
      // Off the screen: drag tilts the device, like the Tamagotchi.
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
  }

  pointerMove(e: PointerEvent) {
    if (!this.active) return;
    if (this.pointerOnScreen) {
      const uv = this.screenUv(e.clientX, e.clientY);
      if (uv) {
        this.lastUv.copy(uv);
        this.gestures.pointerMove(uv.x, uv.y, performance.now() / 1000);
      }
    } else if (this.dragging) {
      this.onTilt(e.clientX - this.lastX, e.clientY - this.lastY);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
  }

  pointerUp(e: PointerEvent) {
    if (!this.active) return;
    if (this.pointerOnScreen) {
      // Released past the edge of the glass: finish the gesture at the last
      // point seen on the screen so a flick keeps its real direction/speed.
      const uv = this.screenUv(e.clientX, e.clientY) ?? this.lastUv;
      this.gestures.pointerUp(uv.x, uv.y, performance.now() / 1000);
    }
    this.pointerOnScreen = false;
    this.dragging = false;
  }

  // ----------------------------------------------------------------- frame

  update(dt: number) {
    if (!this.active) return;
    this.time += dt;
    this.gestures.update(performance.now() / 1000);
    this.world.update(dt);
  }

  render(renderer: WebGLRenderer) {
    if (!this.active) return;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.world.scene, this.world.camera);
    renderer.setRenderTarget(prev);
  }
}
