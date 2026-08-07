import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three";
import { CHARACTERS } from "../sim/data";
import type { PetSnapshot } from "../sim/pet";

export const ICONS = [
  { id: "feed", glyph: "🍚", label: "FEED" },
  { id: "light", glyph: "💡", label: "LIGHT" },
  { id: "game", glyph: "🎮", label: "GAME" },
  { id: "medicine", glyph: "💊", label: "MEDS" },
  { id: "toilet", glyph: "🚽", label: "FLUSH" },
  { id: "meter", glyph: "📊", label: "METER" },
  { id: "discipline", glyph: "📢", label: "SCOLD" },
  { id: "attention", glyph: "❗", label: "CALL" },
] as const;

export type IconId = (typeof ICONS)[number]["id"];

export interface HudView {
  selectedIcon: number | null;
  attentionLit: boolean;
  mode:
    | { kind: "idle" }
    | { kind: "feedMenu"; sel: 0 | 1 }
    | { kind: "meter"; page: number }
    | { kind: "game"; round: number; wins: number; prompt: boolean; lastWin: boolean | null }
    | { kind: "evolving"; flash: number; name: string }
    | { kind: "message"; lines: string[] };
  snapshot: PetSnapshot;
  timeText: string;
}

const SIZE = 1024;
// All layout below was authored against a 384px canvas; U scales it up, and
// TEXT adds extra legibility on top (the LCD is physically small on screen).
const U = SIZE / 384;
const TEXT = 1.22;
const ICON_BAND = 0.15; // fraction of screen height for each icon row

/**
 * 2D overlay composited onto the LCD above the pet world: the classic 8-icon
 * row (top and bottom), meter pages, menus and status text. This layer is
 * sampled at full resolution by the LCD shader — only the pet world behind it
 * gets pixel-quantized — so the text stays readable.
 */
export class ScreenHud {
  private canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  readonly texture: CanvasTexture;

  constructor() {
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.generateMipmaps = false;
  }

  /** Map a screen-plane UV hit to an icon index (or null). */
  static iconAtUv(u: number, v: number): number | null {
    const col = Math.floor(u * 4);
    if (col < 0 || col > 3) return null;
    if (v > 1 - ICON_BAND) return col; // top row: 0..3
    if (v < ICON_BAND) return 4 + col; // bottom row: 4..7
    return null;
  }

  draw(view: HudView) {
    const c = this.ctx;
    c.clearRect(0, 0, SIZE, SIZE);
    this.drawIcons(view);

    const { mode } = view;
    if (mode.kind === "feedMenu") this.drawFeedMenu(mode.sel);
    else if (mode.kind === "meter") this.drawMeter(mode.page, view.snapshot);
    else if (mode.kind === "game") this.drawGame(mode);
    else if (mode.kind === "evolving") this.drawEvolveFlash(mode.flash, mode.name);
    else if (mode.kind === "message") this.drawMessage(mode.lines);
    else this.drawIdle(view);

    this.texture.needsUpdate = true;
  }

  private drawIcons(view: HudView) {
    const c = this.ctx;
    const band = SIZE * ICON_BAND;
    const cell = SIZE / 4;

    const drawRow = (rowTop: number, startIndex: number) => {
      for (let i = 0; i < 4; i++) {
        const idx = startIndex + i;
        const icon = ICONS[idx];
        const cx = i * cell + cell / 2;
        const cy = rowTop + band / 2;
        const selected = view.selectedIcon === idx;
        const isAttention = icon.id === "attention";

        if (selected) {
          c.fillStyle = "rgba(40, 40, 48, 0.85)";
          this.roundRect(c, i * cell + 6 * U, rowTop + 4 * U, cell - 12 * U, band - 8 * U, 10 * U);
          c.fill();
        }

        c.save();
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.font = `${Math.floor(band * 0.62)}px sans-serif`;
        if (isAttention) {
          c.filter = view.attentionLit ? "none" : "grayscale(1) opacity(0.25)";
          if (view.attentionLit) {
            // pulse
            const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 160);
            c.globalAlpha = pulse;
          }
        } else {
          c.filter = selected ? "none" : "grayscale(0.85) opacity(0.55)";
        }
        c.fillText(icon.glyph, cx, cy + 2 * U);
        c.restore();
      }
    };

    drawRow(0, 0);
    drawRow(SIZE - band, 4);
  }

  private panel(x: number, y: number, w: number, h: number) {
    const c = this.ctx;
    c.fillStyle = "rgba(246, 242, 226, 0.96)";
    this.roundRect(c, x, y, w, h, 14 * U);
    c.fill();
    c.strokeStyle = "#22222a";
    c.lineWidth = 5 * U;
    this.roundRect(c, x, y, w, h, 14 * U);
    c.stroke();
  }

  private text(str: string, x: number, y: number, size = 30, align: CanvasTextAlign = "center", color = "#22222a") {
    const c = this.ctx;
    c.fillStyle = color;
    c.font = `bold ${Math.round(size * U * TEXT)}px "Courier New", monospace`;
    c.textAlign = align;
    c.textBaseline = "middle";
    c.fillText(str, x, y);
  }

  private hearts(filled: number, x: number, y: number, size = 34) {
    const c = this.ctx;
    const px = size * U * TEXT;
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (let i = 0; i < 4; i++) {
      c.font = `${Math.round(px)}px sans-serif`;
      c.filter = i < filled ? "none" : "grayscale(1) opacity(0.3)";
      c.fillText(i < filled ? "❤️" : "🖤", x + i * (px + 8 * U), y);
    }
    c.filter = "none";
  }

  private drawIdle(view: HudView) {
    const s = view.snapshot;
    const dead = s.stage === "dead";

    // Clock chip — hidden on the tombstone screen, where the clock means
    // nothing and would collide with the epitaph.
    if (!dead) {
      const chipW = 124 * U;
      const chipH = 38 * U;
      this.ctx.fillStyle = "rgba(34,34,42,0.62)";
      this.roundRect(this.ctx, SIZE - chipW - 8 * U, SIZE * ICON_BAND + 8 * U, chipW, chipH, 8 * U);
      this.ctx.fill();
      this.text(
        view.timeText,
        SIZE - chipW / 2 - 8 * U,
        SIZE * ICON_BAND + 8 * U + chipH / 2,
        21,
        "center",
        "#f6f2e2",
      );
    }

    if (s.asleep && s.lightsOn && s.stage !== "egg" && s.stage !== "dead") {
      this.text("LIGHTS ON!", SIZE / 2, SIZE * 0.245, 26);
    }
    if (s.asleep && !s.lightsOn) {
      const wob = Math.sin(performance.now() / 400) * 6 * U;
      this.text("Z z z", SIZE * 0.7, SIZE * 0.3 + wob, 30, "center", "#aab4d4");
    }
    if (dead) {
      this.ctx.fillStyle = "rgba(246, 242, 226, 0.85)";
      this.ctx.fillRect(0, SIZE * 0.185, SIZE, SIZE * 0.16);
      this.text("R.I.P.", SIZE / 2, SIZE * 0.235, 34);
      const def = CHARACTERS[s.character];
      this.text(`${def.name} · age ${s.ageDays}`, SIZE / 2, SIZE * 0.31, 22);
      this.ctx.fillStyle = "rgba(246, 242, 226, 0.85)";
      this.ctx.fillRect(0, SIZE * 0.765, SIZE, SIZE * 0.07);
      this.text("S: new egg", SIZE / 2, SIZE * 0.8, 20);
    }
  }

  private drawFeedMenu(sel: 0 | 1) {
    this.panel(SIZE * 0.16, SIZE * 0.26, SIZE * 0.68, SIZE * 0.42);
    this.text("FEED", SIZE / 2, SIZE * 0.34, 28);
    const rows: [string, string][] = [
      ["🍞", "MEAL"],
      ["🍬", "SNACK"],
    ];
    rows.forEach(([glyph, label], i) => {
      const y = SIZE * (0.45 + i * 0.11);
      if (sel === i) {
        this.ctx.fillStyle = "#22222a";
        this.roundRect(this.ctx, SIZE * 0.21, y - 24 * U, SIZE * 0.58, 48 * U, 8 * U);
        this.ctx.fill();
      }
      this.ctx.fillStyle = sel === i ? "#f6f2e2" : "#22222a";
      this.ctx.font = `${Math.round(28 * U)}px sans-serif`;
      this.ctx.textAlign = "left";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText(glyph, SIZE * 0.25, y);
      this.text(label, SIZE * 0.4, y, 26, "left", sel === i ? "#f6f2e2" : "#22222a");
    });
  }

  private drawMeter(page: number, s: PetSnapshot) {
    this.panel(SIZE * 0.08, SIZE * 0.2, SIZE * 0.84, SIZE * 0.56);
    const titles = ["HUNGRY", "HAPPY", "STATUS", "TRAINING"];
    this.text(titles[page], SIZE / 2, SIZE * 0.275, 28);
    if (page === 0) {
      this.hearts(s.hungry, SIZE / 2 - 63 * U * TEXT, SIZE * 0.44);
    } else if (page === 1) {
      this.hearts(s.happy, SIZE / 2 - 63 * U * TEXT, SIZE * 0.44);
    } else if (page === 2) {
      const def = CHARACTERS[s.character];
      this.text(def.name, SIZE / 2, SIZE * 0.375, 25);
      this.text(`AGE ${s.ageDays}yr`, SIZE / 2, SIZE * 0.475, 25);
      this.text(`WEIGHT ${s.weight}lb`, SIZE / 2, SIZE * 0.565, 25);
    } else {
      // Discipline bar
      const x = SIZE * 0.18;
      const w = SIZE * 0.64;
      const y = SIZE * 0.4;
      const h = 40 * U;
      this.ctx.strokeStyle = "#22222a";
      this.ctx.lineWidth = 5 * U;
      this.ctx.strokeRect(x, y, w, h);
      this.ctx.fillStyle = "#22222a";
      this.ctx.fillRect(x + 4 * U, y + 4 * U, (w - 8 * U) * (s.discipline / 100), h - 8 * U);
      this.text(`${s.discipline}%`, SIZE / 2, y + h + 34 * U, 24);
    }
    this.text(`${page + 1}/4  A:next D:exit`, SIZE / 2, SIZE * 0.7, 18);
  }

  private drawGame(mode: { round: number; wins: number; prompt: boolean; lastWin: boolean | null }) {
    // Text sits over the moving pet, so give it a readable backing strip.
    const strip = (y: number, h: number) => {
      this.ctx.fillStyle = "rgba(246, 242, 226, 0.82)";
      this.ctx.fillRect(0, y, SIZE, h);
    };
    strip(SIZE * 0.2, SIZE * 0.14);
    this.text(`ROUND ${Math.min(mode.round, 5)}/5`, SIZE / 2, SIZE * 0.24, 24);
    this.text(`WINS ${mode.wins}`, SIZE / 2, SIZE * 0.31, 21);
    if (mode.prompt) {
      const bounce = Math.sin(performance.now() / 220) * 5 * U;
      this.text("◀ A", SIZE * 0.19, SIZE * 0.5 + bounce, 34);
      this.text("S ▶", SIZE * 0.81, SIZE * 0.5 - bounce, 34);
      strip(SIZE * 0.735, SIZE * 0.09);
      this.text("Which way will it turn?", SIZE / 2, SIZE * 0.78, 19);
    } else if (mode.lastWin !== null) {
      strip(SIZE * 0.735, SIZE * 0.09);
      this.text(mode.lastWin ? "😊 RIGHT!" : "😵 WRONG!", SIZE / 2, SIZE * 0.78, 26);
    }
  }

  private drawEvolveFlash(flash: number, name: string) {
    const c = this.ctx;
    c.fillStyle = `rgba(255, 255, 255, ${flash.toFixed(3)})`;
    c.fillRect(0, 0, SIZE, SIZE);
    if (flash < 0.35) {
      this.text(name + "!", SIZE / 2, SIZE * 0.26, 30);
    }
  }

  private drawMessage(lines: string[]) {
    this.panel(SIZE * 0.12, SIZE * 0.3, SIZE * 0.76, SIZE * 0.34);
    lines.forEach((line, i) => {
      this.text(line, SIZE / 2, SIZE * (0.4 + i * 0.09), 22);
    });
  }

  private roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
}
