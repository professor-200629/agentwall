/**
 * The board on the wall: a header, two linked cards (Slot -> Invite), and the
 * demo outbox tray along the bottom.
 *
 * Interactive parts (the invite card and the "Also free" rows) are separate
 * meshes so BoardSystem can make each one its own ray-interactable entity.
 * The board itself only draws; it never reads input.
 *
 * Board-local metres: origin at the centre, +X right, +Y up, +Z out of the wall.
 */
import {
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
} from '@iwsdk/core';
import type { OutboxItem, Plan } from './logic/plan.js';
import { BOARD } from './logic/placement.js';
import type { CalendarData } from './logic/scheduler.js';
import { CanvasPanel, COLORS, drawWrapped, font, pill, PX_PER_M, roundRect } from './ui/canvas-panel.js';
import { CHIPS, type ChipLook } from './chips.js';
import { ALT_ROW, CHIP_FONT_PX, drawAltRow, drawChip, drawGlow, drawInviteCard, drawSlotCard, drawTray } from './ui/cards.js';

export type BoardStatus = 'searching' | 'wall' | 'fallback' | 'preview';

const STATUS: Record<BoardStatus, { chip: string; color: string; hint: string }> = {
  searching: { chip: 'LOOKING FOR A WALL', color: '#9aa4b2', hint: 'Looking for a wall…' },
  wall: { chip: 'ON YOUR WALL', color: COLORS.green, hint: '' },
  fallback: { chip: 'FLOATING · NO WALL FOUND', color: COLORS.amber, hint: '' },
  preview: { chip: 'DESKTOP PREVIEW', color: COLORS.link, hint: '' },
};

/** Rectangles in board metres (x/y = centre). */
export const LAYOUT = (() => {
  const W = BOARD.width;
  const H = BOARD.height;
  const margin = 0.035;
  const header = 0.245;
  const gap = 0.07;
  const trayH = 0.085;
  const top = H / 2 - header - 0.015;
  const bottom = -H / 2 + margin + trayH + 0.015;
  const cardH = top - bottom;
  const slotW = 0.44;
  const inviteW = W - margin * 2 - slotW - gap;
  const left = -W / 2 + margin;
  const slot = { x: left + slotW / 2, y: (top + bottom) / 2, w: slotW, h: cardH };
  const px = (n: number) => n / PX_PER_M;
  const rowH = px(ALT_ROW.heightPx);
  const rowW = slotW - px(ALT_ROW.padPx) * 2;
  const row2y = slot.y - cardH / 2 + px(ALT_ROW.padPx) + rowH / 2;
  // Chip row inside the header, left to right; widths fit each label.
  const measure = document.createElement('canvas').getContext('2d');
  let x = left;
  const chipH = px(60); // 5.9 cm tall: easier to hit with a hand ray
  const chipY = H / 2 - px(182) - chipH / 2;
  const chips = CHIPS.map((chip) => {
    let w = 0.12;
    if (measure) {
      measure.font = `600 ${CHIP_FONT_PX}px system-ui, sans-serif`;
      // The mic chip also shows "● Listening 5", so size it for the longest label.
      const longest = chip.id === 'mic' ? '● Listening 5' : chip.label;
      w = px(measure.measureText(longest).width + 40);
    }
    const r = { x: x + w / 2, y: chipY, w, h: chipH };
    x += w + px(10);
    return r;
  });
  return {
    chips,
    slot,
    invite: { x: left + slotW + gap + inviteW / 2, y: (top + bottom) / 2, w: inviteW, h: cardH },
    gap: { from: left + slotW, to: left + slotW + gap },
    alts: [
      { x: slot.x, y: row2y + rowH + px(ALT_ROW.gapPx), w: rowW, h: rowH },
      { x: slot.x, y: row2y, w: rowW, h: rowH },
    ],
    tray: { x: 0, y: -H / 2 + margin + trayH / 2, w: W - margin * 2, h: trayH },
  };
})();

/** Layers in front of the board, in metres, so nothing z-fights. */
const Z = { glow: 0.002, card: 0.004, alt: 0.006, ring: 0.012 };
const GLOW_PAD = 0.03;
const RING_SEGMENTS = 64;
const FLY_SECONDS = 0.6;

export class Board {
  readonly object = new Group();
  status: BoardStatus = 'searching';
  private plan: Plan | null = null;
  private backPanel = new CanvasPanel(BOARD.width, BOARD.height, 'board');
  readonly slotCard = new CanvasPanel(LAYOUT.slot.w, LAYOUT.slot.h, 'slot-card');
  readonly inviteCard = new CanvasPanel(LAYOUT.invite.w, LAYOUT.invite.h, 'invite-card');
  readonly altRows = LAYOUT.alts.map((r, i) => new CanvasPanel(r.w, r.h, `alt-slot-${i}`));
  private tray = new CanvasPanel(LAYOUT.tray.w, LAYOUT.tray.h, 'outbox-tray');
  private glow = new CanvasPanel(LAYOUT.invite.w + GLOW_PAD * 2, LAYOUT.invite.h + GLOW_PAD * 2, 'invite-glow');
  private ring = new Group();
  private ringFill: Mesh<RingGeometry, MeshBasicMaterial>;
  private flyer: Mesh;
  private flyT = -1;
  readonly chipPanels = LAYOUT.chips.map((r, i) => new CanvasPanel(r.w, r.h, `chip-${CHIPS[i].id}`));
  private chipLooks: string[] = CHIPS.map(() => '');
  private agentLine = { text: '', color: COLORS.muted };
  private hoverInvite = false;
  private hoverAlt: number | null = null;

  constructor(private cal: CalendarData) {
    this.object.name = 'agent-wall';
    this.add(this.backPanel.mesh, 0, 0, 0, 1);
    this.add(this.glow.mesh, LAYOUT.invite.x, LAYOUT.invite.y, Z.glow, 2);
    this.add(this.slotCard.mesh, LAYOUT.slot.x, LAYOUT.slot.y, Z.card, 3);
    this.add(this.inviteCard.mesh, LAYOUT.invite.x, LAYOUT.invite.y, Z.card, 3);
    this.altRows.forEach((row, i) => this.add(row.mesh, LAYOUT.alts[i].x, LAYOUT.alts[i].y, Z.alt, 4));
    this.add(this.tray.mesh, LAYOUT.tray.x, LAYOUT.tray.y, Z.card, 3);
    this.chipPanels.forEach((chip, i) => this.add(chip.mesh, LAYOUT.chips[i].x, LAYOUT.chips[i].y, Z.alt, 4));
    CHIPS.forEach((_c, i) => this.setChip(i, 'normal'));

    // Approval ring: dark disc, faint track, amber fill that grows clockwise from 12 o'clock.
    const disc = new Mesh(
      new CircleGeometry(0.085, 48),
      new MeshBasicMaterial({ color: 0x10141c, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    const track = new Mesh(
      new RingGeometry(0.055, 0.072, RING_SEGMENTS, 1),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    this.ringFill = new Mesh(
      new RingGeometry(0.055, 0.072, RING_SEGMENTS, 1, Math.PI / 2, Math.PI * 2),
      // transparent so it renders after (on top of) the transparent disc and track
      new MeshBasicMaterial({ color: COLORS.amber, side: DoubleSide, transparent: true, depthWrite: false }),
    );
    this.ringFill.scale.x = -1; // mirror: counter-clockwise geometry fills clockwise
    this.ringFill.position.z = 0.001;
    this.ring.add(disc, track, this.ringFill);
    this.ring.renderOrder = 6;
    disc.renderOrder = 6;
    track.renderOrder = 7;
    this.ringFill.renderOrder = 8;
    this.ring.position.set(LAYOUT.invite.x, LAYOUT.invite.y, Z.ring);
    this.ring.visible = false;
    this.object.add(this.ring);

    // The flying copy of the invite on approval (shares the card's texture).
    this.flyer = new Mesh(this.inviteCard.mesh.geometry, this.inviteCard.mesh.material);
    this.flyer.visible = false;
    this.flyer.renderOrder = 9;
    this.object.add(this.flyer);

    for (const m of [this.slotCard, this.inviteCard, this.glow, ...this.altRows]) m.mesh.visible = false;
    this.glow.draw((c, w, h) => drawGlow(c, w, h, GLOW_PAD * PX_PER_M * 0.5));
    this.setOutbox([]);
    this.object.visible = false;
    this.drawBack();
  }

  private add(mesh: Mesh, x: number, y: number, z: number, order: number): void {
    mesh.position.set(x, y, z);
    mesh.renderOrder = order;
    this.object.add(mesh);
  }

  setStatus(status: BoardStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.drawBack();
  }

  /** Show a plan. Redraws only when plan.version changes. */
  setPlan(plan: Plan | null): void {
    if (plan === this.plan) return;
    const changed = !this.plan || !plan || plan.version !== this.plan.version;
    this.plan = plan;
    if (!changed) return;
    const show = plan !== null;
    this.slotCard.mesh.visible = this.inviteCard.mesh.visible = show;
    if (plan) {
      this.slotCard.draw((c, w, h) => drawSlotCard(c, w, h, plan, this.cal));
      this.inviteCard.draw((c, w, h) => drawInviteCard(c, w, h, plan));
    }
    this.drawAlts();
    this.drawBack();
  }

  /** Redraw one chip, only when its look or label changed. */
  setChip(i: number, look: ChipLook, label = CHIPS[i].label): void {
    const key = `${look}|${label}`;
    if (this.chipLooks[i] === key) return;
    this.chipLooks[i] = key;
    this.chipPanels[i].draw((c, w, h) => drawChip(c, w, h, label, look));
  }

  /** The "who planned this / what is happening" line in the header. */
  setAgentLine(text: string, tone: 'muted' | 'ai' | 'warn' | 'ok' = 'muted'): void {
    const color = { muted: COLORS.muted, ai: COLORS.link, warn: COLORS.amber, ok: COLORS.green }[tone];
    if (text === this.agentLine.text && color === this.agentLine.color) return;
    this.agentLine = { text, color };
    this.drawBack();
  }

  setOutbox(items: OutboxItem[]): void {
    this.tray.draw((c, w, h) => drawTray(c, w, h, items));
  }

  /** Hover feedback: brighter glow on the invite, highlighted alt row. */
  setHover(invite: boolean, alt: number | null): void {
    this.hoverInvite = invite;
    if (alt !== this.hoverAlt) {
      this.hoverAlt = alt;
      this.drawAlts();
    }
  }

  /** 0..1 approval progress; 0 hides the ring. */
  setHold(progress: number): void {
    this.ring.visible = progress > 0;
    const segs = Math.round(progress * RING_SEGMENTS);
    this.ringFill.geometry.setDrawRange(0, segs * 6);
  }

  /** Start the "invite flies into the outbox" animation. */
  celebrate(): void {
    this.flyT = 0;
    this.flyer.visible = true;
  }

  /** Per-frame animation (glow pulse, fly). Cheap: no allocation, no redraws. */
  tick(dt: number, time: number): void {
    const needs = this.plan?.invite != null && this.plan.approval === 'needs';
    this.glow.mesh.visible = needs && this.object.visible;
    if (this.glow.mesh.visible) {
      const pulse = 0.55 + 0.35 * Math.sin(time * 3.2);
      (this.glow.mesh.material as MeshBasicMaterial).opacity = this.hoverInvite ? 1 : pulse;
    }
    if (this.flyT >= 0) {
      this.flyT += dt;
      const t = Math.min(1, this.flyT / FLY_SECONDS);
      const e = t * t * (3 - 2 * t); // smoothstep
      const from = LAYOUT.invite;
      const to = LAYOUT.tray;
      this.flyer.position.set(
        from.x + (to.x - from.x + 0.1) * e,
        from.y + (to.y - from.y) * e,
        Z.ring + 0.01,
      );
      this.flyer.scale.setScalar(1 - 0.85 * e);
      if (t >= 1) {
        this.flyT = -1;
        this.flyer.visible = false;
      }
    }
  }

  private drawAlts(): void {
    const alts = this.plan?.alternatives ?? [];
    this.altRows.forEach((row, i) => {
      row.mesh.visible = this.plan !== null && i < alts.length;
      if (row.mesh.visible) row.draw((c, w, h) => drawAltRow(c, w, h, alts[i], this.hoverAlt === i));
    });
  }

  private drawBack(): void {
    const s = STATUS[this.status];
    const plan = this.plan;
    this.backPanel.draw((c, W, H) => {
      roundRect(c, 4, 4, W - 8, H - 8, 36);
      c.fillStyle = COLORS.board;
      c.fill();
      c.lineWidth = 4;
      c.strokeStyle = COLORS.line;
      c.stroke();

      font(c, 54, 700);
      c.fillStyle = COLORS.text;
      c.fillText('Agent Wall', 44, 86);
      pill(c, s.chip, W - 44, 46, s.color, COLORS.ink, 20, true);

      font(c, 28, 500);
      c.fillStyle = COLORS.text;
      const task = plan ? `Task · ${plan.task}` : s.hint || 'Ask your agent: pinch a chip below, or 🎤 Speak';
      drawWrapped(c, task, 44, 130, W - 88, 34, 1);
      font(c, 24);
      c.fillStyle = COLORS.muted;
      const rule = plan?.constraintText ? `Rule · ${plan.constraintText}` : 'Rule · none';
      c.fillText(rule, 44, 164);
      if (this.agentLine.text) {
        const ruleW = c.measureText(rule).width;
        font(c, 22, 600);
        c.fillStyle = this.agentLine.color;
        const maxW = W - 88 - ruleW - 40;
        let t = this.agentLine.text;
        while (t.length > 4 && c.measureText(t).width > maxW) t = `${t.slice(0, -2)}…`;
        c.fillText(t, W - 44 - c.measureText(t).width, 164);
      }

      if (!plan) {
        const top = 266;
        const bottom = (BOARD.height / 2 - (LAYOUT.tray.y + LAYOUT.tray.h / 2)) * PX_PER_M - 14;
        c.setLineDash([14, 12]);
        c.lineWidth = 3;
        c.strokeStyle = COLORS.line;
        roundRect(c, 44, top, W - 88, bottom - top, 24);
        c.stroke();
        c.setLineDash([]);
        const mid = (top + bottom) / 2;
        font(c, 32, 600);
        c.fillStyle = COLORS.text;
        const hint = 'Pinch “Find time + draft invite” to start';
        c.fillText(hint, (W - c.measureText(hint).width) / 2, mid - 8);
        font(c, 26);
        c.fillStyle = COLORS.muted;
        const how = 'Point your hand at a chip, then tap your thumb and index finger together';
        c.fillText(how, (W - c.measureText(how).width) / 2, mid + 36);
        return;
      }

      // Link arrow between the cards: Slot -> Invite ("uses").
      const toPx = (xm: number) => (xm + BOARD.width / 2) * PX_PER_M;
      const toPy = (ym: number) => (BOARD.height / 2 - ym) * PX_PER_M;
      const x0 = toPx(LAYOUT.gap.from) + 6;
      const x1 = toPx(LAYOUT.gap.to) - 6;
      const y = toPy(LAYOUT.slot.y);
      c.strokeStyle = COLORS.link;
      c.fillStyle = COLORS.link;
      c.lineWidth = 5;
      c.beginPath();
      c.moveTo(x0, y);
      c.lineTo(x1 - 14, y);
      c.stroke();
      c.beginPath();
      c.moveTo(x1, y);
      c.lineTo(x1 - 18, y - 12);
      c.lineTo(x1 - 18, y + 12);
      c.closePath();
      c.fill();
      c.beginPath();
      c.arc(x0, y, 7, 0, Math.PI * 2);
      c.fill();
      font(c, 20, 700);
      const word = 'uses';
      c.fillText(word, (x0 + x1) / 2 - c.measureText(word).width / 2, y - 18);
    });
  }
}
