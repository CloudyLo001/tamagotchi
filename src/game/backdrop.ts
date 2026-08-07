import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
} from "three";
import { assetUrl } from "../assets/registry";

const BACKDROP_Z = -3;
const HALO_Z = -0.9;

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
 * The mint-generated pastel scene sitting behind the floating device. It is a
 * plane rather than a scene background so it can cover-fit the viewport at any
 * aspect and drift for parallax when the device is dragged.
 */
export class Backdrop {
  readonly mesh: Mesh;
  readonly halo: Mesh;
  private imageAspect = 1.79; // updated once the texture loads
  private loaded = false;

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

    const material = new MeshBasicMaterial({
      color: 0xe8dcff, // calm fallback tint until (or unless) the image loads
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(1, 1), material);
    this.mesh.position.z = BACKDROP_Z;
    this.mesh.renderOrder = -1;

    const url = assetUrl("backdrop");
    if (url) {
      new TextureLoader().load(
        url,
        (texture) => {
          texture.colorSpace = SRGBColorSpace;
          this.imageAspect = texture.image.width / texture.image.height;
          material.map = texture;
          material.color.set(0xffffff);
          material.needsUpdate = true;
          this.loaded = true;
        },
        undefined,
        (err) => console.warn("[backdrop] failed to load:", err),
      );
    }
  }

  /** Size the plane to cover the camera frustum at its depth (CSS "cover"). */
  resize(camera: PerspectiveCamera) {
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

  /** Gentle counter-drift so the device feels like it floats in front. */
  update(tiltX: number, tiltY: number, timeSec: number) {
    // The halo tracks the device's own bob, so it reads as a cast shadow.
    this.halo.position.y = -0.04 + Math.sin(timeSec * 1.1) * 0.012;
    if (!this.loaded) return;
    this.mesh.position.x = -tiltY * 0.9 + Math.sin(timeSec * 0.13) * 0.05;
    this.mesh.position.y = -tiltX * 0.7 + Math.cos(timeSec * 0.17) * 0.04;
  }
}
