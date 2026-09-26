import {
  Box3,
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
  type Object3D,
} from "three";
import { assetUrl } from "../assets/registry";
import type { BackdropId } from "../sim/save";
import { backdropTheme } from "./themes";

const BACKDROP_Z = -3;
const HALO_Z = -0.9;
const SHADOW_Z = -0.6;
/** Light from the top left: the shadow falls down and slightly right. */
const SHADOW_OFFSET = { x: 0.06, y: -0.12 };

/** Soft radial shadow that grounds the floating device against busy art. */
function makeHaloTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(70, 45, 95, 0.42)");
  g.addColorStop(0.45, "rgba(70, 45, 95, 0.22)");
  g.addColorStop(1, "rgba(70, 45, 95, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

/**
 * Blurred rounded silhouette for the plain themes' drop shadow. Drawn with
 * canvas shadowBlur (the shape itself is pushed off-canvas), which every
 * browser supports, unlike ctx.filter.
 */
function makeDropShadowTexture() {
  const size = 256;
  const pad = 40;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.shadowColor = "rgba(255, 255, 255, 1)"; // white; tinted per theme
  ctx.shadowBlur = 18;
  ctx.shadowOffsetX = size * 4;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.roundRect(pad - size * 4, pad, size - pad * 2, size - pad * 2, 52);
  ctx.fill();
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * The mint-generated pastel scene sitting behind the floating device. It is a
 * plane rather than a scene background so it can cover-fit the viewport at any
 * aspect and drift for parallax when the device is dragged.
 */
export class Backdrop {
  readonly mesh: Mesh;
  readonly halo: Mesh;
  /** Drop shadow behind the device, shown on the plain themes only. */
  readonly shadow: Mesh;
  private shadowMaterial: MeshBasicMaterial;
  private plain = false;
  private glow = false;
  private box = new Box3();
  private size = new Vector3();
  private center = new Vector3();
  private material: MeshBasicMaterial;
  private imageAspect = 1.79; // updated once the texture loads
  private loaded = false;
  private currentId: BackdropId | null = null;
  private loadToken = 0;
  private textures = new Map<string, Texture>();
  private camera: PerspectiveCamera | null = null;

  constructor() {
    this.halo = new Mesh(
      new PlaneGeometry(1.9, 2.1),
      new MeshBasicMaterial({
        map: makeHaloTexture(),
        transparent: true,
        depthWrite: false,
        blending: NormalBlending,
        toneMapped: false,
      }),
    );
    this.halo.position.set(0, -0.04, HALO_Z);
    this.halo.renderOrder = 0;

    this.shadowMaterial = new MeshBasicMaterial({
      map: makeDropShadowTexture(),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      opacity: 0.5,
    });
    this.shadow = new Mesh(new PlaneGeometry(1, 1), this.shadowMaterial);
    this.shadow.position.z = SHADOW_Z;
    this.shadow.renderOrder = 0;
    this.shadow.visible = false;

    this.material = new MeshBasicMaterial({
      color: 0xe8dcff, // calm fallback tint until (or unless) the image loads
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
    this.mesh.position.z = BACKDROP_Z;
    this.mesh.renderOrder = -1;
  }

  /**
   * Swap to a themed backdrop. Textures are cached, so flipping between themes
   * in settings only pays the download once. Falls back to the theme's flat
   * colour when its image has not been synced.
   */
  setTheme(id: BackdropId) {
    if (this.currentId === id) return;
    this.currentId = id;
    const theme = backdropTheme(id);
    const token = ++this.loadToken;
    this.plain = !!theme.plain;
    this.halo.visible = !this.plain;
    this.shadow.visible = this.plain;
    // A shadow can't show on pure black, so there the device gets a faint
    // centred glow instead (how elevation reads on dark UI).
    this.glow = theme.fallback === 0x000000;
    this.shadowMaterial.color.set(this.glow ? 0xffffff : 0x000000);
    this.shadowMaterial.opacity = this.glow ? 0.26 : 0.38;

    const apply = (texture: Texture | null) => {
      if (token !== this.loadToken) return; // a newer selection won
      if (texture) {
        const img = texture.image as { width: number; height: number };
        this.imageAspect = img.width / img.height;
        this.material.map = texture;
        this.material.color.set(0xffffff);
        this.loaded = true;
      } else {
        this.material.map = null;
        this.material.color.set(theme.fallback);
        this.loaded = false;
      }
      this.material.needsUpdate = true;
      if (this.camera) this.resize(this.camera);
    };

    const cached = this.textures.get(theme.key);
    if (cached) {
      apply(cached);
      return;
    }

    const url = theme.key ? assetUrl(theme.key) : null;
    if (!url) {
      apply(null);
      return;
    }
    new TextureLoader().load(
      url,
      (texture) => {
        texture.colorSpace = SRGBColorSpace;
        this.textures.set(theme.key, texture);
        apply(texture);
      },
      undefined,
      (err) => {
        console.warn(`[backdrop] failed to load "${theme.key}":`, err);
        apply(null);
      },
    );
  }

  /** Size the plane to cover the camera frustum at its depth (CSS "cover"). */
  resize(camera: PerspectiveCamera) {
    this.camera = camera;
    const distance = camera.position.z - BACKDROP_Z;
    const frustumH = 2 * distance * Math.tan((camera.fov * Math.PI) / 360);
    const frustumW = frustumH * camera.aspect;
    // Overscan so parallax drift never exposes an edge.
    const coverW = Math.max(frustumW, frustumH * this.imageAspect) * 1.18;
    this.mesh.scale.set(coverW, coverW / this.imageAspect, 1);
    if (this.mesh.scale.y < frustumH * 1.18) {
      this.mesh.scale.set(frustumH * 1.18 * this.imageAspect, frustumH * 1.18, 1);
    }
  }

  /**
   * Fit the drop shadow to whichever device is showing. It sits behind the
   * device, so it is scaled up to cancel the perspective shrink, and it
   * follows the bob and tilt.
   */
  fitShadow(device: Object3D, camera: PerspectiveCamera) {
    if (!this.plain) return;
    this.box.setFromObject(device);
    if (this.box.isEmpty()) return;
    this.box.getSize(this.size);
    this.box.getCenter(this.center);
    const depth = camera.position.z - SHADOW_Z;
    const grow = depth / (camera.position.z - this.center.z);
    // The texture's shape fills (256 - 2*40)/256 of the plane; shrink a
    // touch so the blur, not the core, reaches the device's outline.
    const fill = (256 / (256 - 2 * 40)) * 0.9;
    this.shadow.scale.set(this.size.x * grow * fill, this.size.y * grow * fill, 1);
    const off = this.glow ? 0 : 1;
    this.shadow.position.set(
      (this.center.x + SHADOW_OFFSET.x * off) * grow,
      (this.center.y + SHADOW_OFFSET.y * off) * grow,
      SHADOW_Z,
    );
  }

  /** Gentle counter-drift so the device feels like it floats in front. */
  update(tiltX: number, tiltY: number, timeSec: number) {
    // The halo tracks the device's own bob, so it reads as a cast shadow.
    this.halo.position.y = -0.04 + Math.sin(timeSec * 1.1) * 0.012;
    if (!this.loaded) return;
    this.mesh.position.x = -tiltY * 0.9 + Math.sin(timeSec * 0.13) * 0.05;
    this.mesh.position.y = -tiltX * 0.7 + Math.cos(timeSec * 0.17) * 0.04;
  }
}
