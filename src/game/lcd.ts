import { ShaderMaterial, Texture } from "three";

/**
 * Composites the device's LCD.
 *
 * The pet world gets the retro treatment — pixel quantization, a faint cell
 * grid, greenish-cream tint. The HUD/text layer is sampled at full resolution
 * on top of it, so icons and readouts stay sharp no matter how coarse the
 * pixelation is. `effect` fades the retro treatment (world only) in and out.
 */
export function createLcdMaterial(worldMap: Texture, hudMap: Texture) {
  return new ShaderMaterial({
    uniforms: {
      worldMap: { value: worldMap },
      hudMap: { value: hudMap },
      cells: { value: 96 },
      effect: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D worldMap;
      uniform sampler2D hudMap;
      uniform float cells;
      uniform float effect;
      varying vec2 vUv;

      void main() {
        // --- pet world: quantized to LCD cells ---
        vec2 quv = (floor(vUv * cells) + 0.5) / cells;
        vec3 raw = texture2D(worldMap, mix(vUv, quv, effect)).rgb;

        // Greenish-cream LCD tint
        vec3 col = mix(raw, raw * vec3(0.82, 0.88, 0.72) + vec3(0.10, 0.11, 0.06), 0.55);

        // Faint cell grid
        vec2 cellPos = fract(vUv * cells);
        col *= 1.0 - 0.10 * step(0.86, max(cellPos.x, cellPos.y));

        col = mix(raw, col, effect);

        // --- HUD/text: full resolution, no quantization, no grid ---
        vec4 hud = texture2D(hudMap, vUv);
        // Match the panel to the LCD's warmth without muddying the glyphs.
        vec3 hudCol = mix(hud.rgb, hud.rgb * vec3(0.96, 0.99, 0.92), effect);
        col = mix(col, hudCol, hud.a);

        // Slight vignette like a recessed panel
        float d = distance(vUv, vec2(0.5));
        col *= 1.0 - 0.18 * effect * smoothstep(0.32, 0.72, d);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
