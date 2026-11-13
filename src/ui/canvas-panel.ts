/**
 * A flat rectangle in 3D whose face is a 2D canvas. Redrawn only when asked,
 * so each panel costs one draw call and one texture upload per change.
 */
import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';

/** Canvas pixels per metre. 1024 px/m keeps 26 px text about 2.5 cm tall. */
export const PX_PER_M = 1024;

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const COLORS = {
  text: '#ffffff',
  muted: 'rgba(255, 255, 255, 0.68)',
  faint: 'rgba(255, 255, 255, 0.4)',
  line: 'rgba(255, 255, 255, 0.22)',
  board: 'rgba(16, 20, 28, 0.82)',
  card: 'rgba(30, 37, 50, 0.96)',
  link: '#7fb2ff',
  amber: '#f2b84b',
  green: '#5ad19a',
  ink: '#10141c',
};

export class CanvasPanel {
  readonly mesh: Mesh;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private texture: CanvasTexture;

  constructor(
    readonly widthM: number,
    readonly heightM: number,
    name: string,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(widthM * PX_PER_M);
    this.canvas.height = Math.round(heightM * PX_PER_M);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not available');
    this.ctx = ctx;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new Mesh(
      new PlaneGeometry(widthM, heightM),
      new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }),
    );
    this.mesh.name = name;
  }

  get w(): number {
    return this.canvas.width;
  }

  get h(): number {
    return this.canvas.height;
  }

  /** Clear, run the drawing function, upload once. */
  draw(fn: (c: CanvasRenderingContext2D, w: number, h: number) => void): void {
    this.ctx.clearRect(0, 0, this.w, this.h);
    this.ctx.save();
    fn(this.ctx, this.w, this.h);
    this.ctx.restore();
    this.texture.needsUpdate = true;
  }
}

export function roundRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

export function font(c: CanvasRenderingContext2D, px: number, weight = 400): void {
  c.font = `${weight} ${px}px ${FONT}`;
}

/** Split text into lines that fit maxWidth (current font). Long words are kept whole. */
export function wrap(c: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && c.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Draw wrapped text from (x, y) downwards; returns the y below the last line.
 * Stops at maxLines, ending the last line with "…".
 */
export function drawWrapped(
  c: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = Infinity,
): number {
  const lines = wrap(c, text, maxWidth);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines && shown.length > 0) {
    let last = shown[shown.length - 1];
    while (last.length > 1 && c.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    shown[shown.length - 1] = `${last}…`;
  }
  for (const l of shown) {
    c.fillText(l, x, y);
    y += lineHeight;
  }
  return y;
}

/** Small rounded label; returns its width. Right-aligned when alignRight. */
export function pill(
  c: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  bg: string,
  fg: string,
  px = 22,
  alignRight = false,
): number {
  font(c, px, 700);
  const w = c.measureText(text).width + px * 1.4;
  const h = px * 1.8;
  const left = alignRight ? x - w : x;
  roundRect(c, left, y, w, h, h / 2);
  c.fillStyle = bg;
  c.fill();
  c.fillStyle = fg;
  c.textBaseline = 'middle';
  c.fillText(text, left + px * 0.7, y + h / 2 + 1);
  c.textBaseline = 'alphabetic';
  return w;
}
