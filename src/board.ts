/**
 * The board on the wall: a header (title, placement, task, rule) and two
 * linked cards, Slot -> Invite. Each card is its own mesh so it can later be
 * pinched, dragged and made to glow on its own.
 *
 * Board-local metres: origin at the centre, +X right, +Y up, +Z out of the wall.
 */
import { Group } from '@iwsdk/core';
import type { Plan } from './logic/plan.js';
import { BOARD } from './logic/placement.js';
import type { CalendarData } from './logic/scheduler.js';
import { CanvasPanel, COLORS, drawWrapped, font, pill, PX_PER_M, roundRect } from './ui/canvas-panel.js';
import { drawInviteCard, drawSlotCard } from './ui/cards.js';

export type BoardStatus = 'searching' | 'wall' | 'fallback' | 'preview';

const STATUS: Record<BoardStatus, { chip: string; color: string; hint: string }> = {
  searching: { chip: 'LOOKING FOR A WALL', color: '#9aa4b2', hint: 'Looking for a wall…' },
  wall: { chip: 'ON YOUR WALL', color: COLORS.green, hint: '' },
  fallback: { chip: 'FLOATING · NO WALL FOUND', color: COLORS.amber, hint: '' },
  preview: { chip: 'DESKTOP PREVIEW', color: COLORS.link, hint: '' },
};

/** Card rectangles in board metres (x/y = centre). */
export const LAYOUT = (() => {
  const W = BOARD.width;
  const H = BOARD.height;
  const margin = 0.04;
  const header = 0.17;
  const gap = 0.07;
  const top = H / 2 - header - 0.015;
  const bottom = -H / 2 + margin;
  const cardH = top - bottom;
  const slotW = 0.44;
  const inviteW = W - margin * 2 - slotW - gap;
  const left = -W / 2 + margin;
  return {
    slot: { x: left + slotW / 2, y: (top + bottom) / 2, w: slotW, h: cardH },
    invite: { x: left + slotW + gap + inviteW / 2, y: (top + bottom) / 2, w: inviteW, h: cardH },
    gap: { from: left + slotW, to: left + slotW + gap },
  };
})();

/** Cards sit a few millimetres in front of the board so they never z-fight. */
const CARD_Z = 0.004;

export class Board {
  readonly object = new Group();
  status: BoardStatus = 'searching';
  private plan: Plan | null = null;
  private backPanel = new CanvasPanel(BOARD.width, BOARD.height, 'board');
  readonly slotCard = new CanvasPanel(LAYOUT.slot.w, LAYOUT.slot.h, 'slot-card');
  readonly inviteCard = new CanvasPanel(LAYOUT.invite.w, LAYOUT.invite.h, 'invite-card');

  constructor(private cal: CalendarData) {
    this.object.name = 'agent-wall';
    this.object.add(this.backPanel.mesh);
    this.backPanel.mesh.renderOrder = 1;
    for (const [card, rect] of [
      [this.slotCard, LAYOUT.slot],
      [this.inviteCard, LAYOUT.invite],
    ] as const) {
      card.mesh.position.set(rect.x, rect.y, CARD_Z);
      card.mesh.renderOrder = 2;
      card.mesh.visible = false;
      this.object.add(card.mesh);
    }
    this.object.visible = false;
    this.drawBack();
  }

  setStatus(status: BoardStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.drawBack();
  }

  /** Show a plan. Redraws only what changed (by plan.version). */
  setPlan(plan: Plan | null): void {
    if (plan === this.plan) return;
    const changed = !this.plan || !plan || plan.version !== this.plan.version;
    this.plan = plan;
    if (!changed) return;
    this.slotCard.mesh.visible = this.inviteCard.mesh.visible = plan !== null;
    if (plan) {
      this.slotCard.draw((c, w, h) => drawSlotCard(c, w, h, plan, this.cal));
      this.inviteCard.draw((c, w, h) => drawInviteCard(c, w, h, plan));
    }
    this.drawBack();
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
      const task = plan ? `Task · ${plan.task}` : s.hint || 'Task · none yet';
      drawWrapped(c, task, 44, 132, W - 88, 34, 1);
      font(c, 24);
      c.fillStyle = COLORS.muted;
      c.fillText(plan?.constraintText ? `Rule · ${plan.constraintText}` : 'Rule · none', 44, 166);

      if (!plan) {
        // Empty card area.
        const top = 196;
        c.setLineDash([14, 12]);
        c.lineWidth = 3;
        c.strokeStyle = COLORS.line;
        roundRect(c, 44, top, W - 88, H - top - 44, 24);
        c.stroke();
        c.setLineDash([]);
        font(c, 28);
        c.fillStyle = COLORS.faint;
        const hint = 'Your agent’s plan will appear here';
        c.fillText(hint, (W - c.measureText(hint).width) / 2, top + (H - top - 44) / 2 + 10);
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
