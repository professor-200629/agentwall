/**
 * The board: one flat panel drawn on a canvas texture. Day 1 shows only the
 * title, where it was placed, and an empty area where cards will go.
 *
 * One mesh, one texture, redrawn only when the status changes, which keeps it
 * cheap on Quest.
 */
import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';
import { BOARD } from './logic/placement.js';

export type BoardStatus = 'searching' | 'wall' | 'fallback' | 'preview';

const PX_PER_M = 1024; // canvas resolution: 1.0 m board -> 1024 px wide

const STATUS_TEXT: Record<BoardStatus, { chip: string; line: string; color: string }> = {
  searching: { chip: 'LOOKING', line: 'Looking for a wall…', color: '#9aa4b2' },
  wall: { chip: 'ON YOUR WALL', line: 'Placed on a wall in your room', color: '#5ad19a' },
  fallback: {
    chip: 'FLOATING',
    line: 'No wall in front of you — floating 1.2 m ahead',
    color: '#f2b84b',
  },
  preview: { chip: 'PREVIEW', line: 'Desktop preview — enter mixed reality to use your wall', color: '#7fb2ff' },
};

export class Board {
  readonly object = new Group();
  status: BoardStatus = 'searching';
  private canvas: HTMLCanvasElement;
  private texture: CanvasTexture;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(BOARD.width * PX_PER_M);
    this.canvas.height = Math.round(BOARD.height * PX_PER_M);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;

    const mesh = new Mesh(
      new PlaneGeometry(BOARD.width, BOARD.height),
      new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }),
    );
    mesh.name = 'agent-wall-board';
    mesh.renderOrder = 1;
    this.object.add(mesh);
    this.object.name = 'agent-wall';
    this.object.visible = false;
    this.draw();
  }

  setStatus(status: BoardStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.draw();
  }

  private draw(): void {
    const c = this.canvas.getContext('2d');
    if (!c) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const s = STATUS_TEXT[this.status];
    c.clearRect(0, 0, W, H);

    // Card body.
    roundRect(c, 4, 4, W - 8, H - 8, 36);
    c.fillStyle = 'rgba(16, 20, 28, 0.82)';
    c.fill();
    c.lineWidth = 4;
    c.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    c.stroke();

    // Title.
    c.fillStyle = '#ffffff';
    c.font = '600 56px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    c.textBaseline = 'alphabetic';
    c.fillText('Agent Wall', 48, 96);

    // Status chip.
    c.font = '600 24px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    const chipW = c.measureText(s.chip).width + 36;
    roundRect(c, W - 48 - chipW, 56, chipW, 46, 23);
    c.fillStyle = s.color;
    c.fill();
    c.fillStyle = '#10141c';
    c.fillText(s.chip, W - 48 - chipW + 18, 88);

    // Status line.
    c.fillStyle = 'rgba(255, 255, 255, 0.72)';
    c.font = '400 30px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    c.fillText(s.line, 48, 146);

    // Empty card area (cards arrive on Day 2).
    c.setLineDash([14, 12]);
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    roundRect(c, 48, 186, W - 96, H - 186 - 48, 24);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = 'rgba(255, 255, 255, 0.4)';
    c.font = '400 28px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    const hint = 'Your agent’s plan will appear here';
    c.fillText(hint, (W - c.measureText(hint).width) / 2, 186 + (H - 186 - 48) / 2 + 10);

    this.texture.needsUpdate = true;
  }
}

function roundRect(
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
