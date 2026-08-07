import {
  LinearFilter,
  Mesh,
  PlaneGeometry,
  SRGBColorSpace,
  WebGLRenderTarget,
  WebGLRenderer,
} from "three";
import { createLcdMaterial } from "./lcd";
import type { PetWorld } from "./petScene";
import type { ScreenHud } from "./hud";

/**
 * Renders the pet world into a render target and maps it onto the device's
 * LCD through the LCD shader, which composites the HUD canvas on top at full
 * resolution (see lcd.ts — only the world is pixelated).
 */
export class ScreenRenderer {
  readonly target: WebGLRenderTarget;
  readonly mesh: Mesh;
  private material: ReturnType<typeof createLcdMaterial>;
  private anisotropyApplied = false;

  constructor(hud: ScreenHud, size = 1024) {
    this.target = new WebGLRenderTarget(size, size);
    this.target.texture.colorSpace = SRGBColorSpace;
    this.target.texture.minFilter = LinearFilter;
    this.material = createLcdMaterial(this.target.texture, hud.texture);
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
    this.mesh.name = "lcd-screen";
  }

  setLcdEffect(on: boolean) {
    this.material.uniforms.effect.value = on ? 1 : 0;
  }

  render(renderer: WebGLRenderer, world: PetWorld, hud: ScreenHud) {
    if (!this.anisotropyApplied) {
      // The LCD is viewed at a slight angle; anisotropic filtering keeps the
      // text crisp instead of smearing it.
      const max = renderer.capabilities.getMaxAnisotropy();
      this.target.texture.anisotropy = max;
      hud.texture.anisotropy = max;
      hud.texture.needsUpdate = true;
      this.anisotropyApplied = true;
    }
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(world.scene, world.camera);
    renderer.setRenderTarget(prevTarget);
  }
}
