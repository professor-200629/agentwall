/**
 * Drawing for the two linked cards. Pure canvas code: (context, size, plan) in,
 * pixels out. Layout numbers are canvas pixels.
 */
import type { Plan } from '../logic/plan.js';
import { clock, clockRange, dayLabel, type CalendarData, type Slot } from '../logic/scheduler.js';
import { COLORS, drawWrapped, font, pill, roundRect } from './canvas-panel.js';

const PAD = 32;

function cardBody(c: CanvasRenderingContext2D, w: number, h: number, accent: string): void {
  roundRect(c, 3, 3, w - 6, h - 6, 26);
  c.fillStyle = COLORS.card;
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = COLORS.line;
  c.stroke();
  // Accent bar on top: both cards share the link colour.
  c.save();
  roundRect(c, 3, 3, w - 6, h - 6, 26);
  c.clip();
  c.fillStyle = accent;
  c.fillRect(0, 0, w, 8);
  c.restore();
}

function label(c: CanvasRenderingContext2D, text: string, color: string): void {
  font(c, 22, 700);
  c.fillStyle = color;
  c.fillText(text.split('').join(' '), PAD, 56);
}

const shortSlot = (s: Slot) => `${dayLabel(s.day).short} · ${clock(s.start)}`;

export function drawSlotCard(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  plan: Plan,
  cal: CalendarData,
): void {
  cardBody(c, w, h, COLORS.link);
  label(c, 'SLOT', COLORS.link);
  const inner = w - PAD * 2;

  if (!plan.slot) {
    font(c, 44, 700);
    c.fillStyle = COLORS.text;
    c.fillText('No free time', PAD, 140);
    font(c, 26);
    c.fillStyle = COLORS.muted;
    drawWrapped(c, plan.reason, PAD, 190, inner, 34, 5);
    return;
  }

  const day = dayLabel(plan.slot.day);
  font(c, 52, 700);
  c.fillStyle = COLORS.text;
  c.fillText(day.weekday, PAD, 128);
  font(c, 32, 500);
  c.fillStyle = COLORS.muted;
  c.fillText(day.long.split(' ').slice(1).join(' '), PAD, 170);

  font(c, 42, 700);
  c.fillStyle = COLORS.text;
  c.fillText(clockRange(plan.slot.start, plan.slot.end), PAD, 238);
  font(c, 26);
  c.fillStyle = COLORS.muted;
  c.fillText(`${cal.timezone} · ${plan.slot.end - plan.slot.start} min · you + ${cal.guest.name}`, PAD, 276);

  font(c, 26);
  c.fillStyle = COLORS.muted;
  drawWrapped(c, plan.reason, PAD, 328, inner, 32, 2);

  if (plan.alternatives.length > 0) {
    // The rows themselves are separate pinchable meshes (see ALT_ROW).
    font(c, 22, 600);
    c.fillStyle = COLORS.faint;
    c.fillText('ALSO FREE · PINCH TO USE', PAD, h - ALT_ROW.labelFromBottomPx);
  }
}

/** Pixel layout of the "Also free" rows, shared with the board so meshes line up. */
export const ALT_ROW = {
  heightPx: 46,
  gapPx: 8,
  padPx: PAD,
  labelFromBottomPx: PAD + 46 * 2 + 8 + 16,
};

export function drawAltRow(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  slot: Slot | undefined,
  hovered: boolean,
): void {
  if (!slot) return;
  roundRect(c, 2, 2, w - 4, h - 4, 12);
  c.fillStyle = hovered ? 'rgba(127, 178, 255, 0.28)' : 'rgba(255, 255, 255, 0.07)';
  c.fill();
  c.lineWidth = hovered ? 3 : 2;
  c.strokeStyle = hovered ? COLORS.link : COLORS.line;
  c.stroke();
  font(c, 24, 500);
  c.fillStyle = COLORS.text;
  c.textBaseline = 'middle';
  c.fillText(shortSlot(slot), 16, h / 2 + 1);
  font(c, 20, 700);
  c.fillStyle = COLORS.link;
  const use = 'USE ⇄';
  c.fillText(use, w - 16 - c.measureText(use).width, h / 2 + 1);
  c.textBaseline = 'alphabetic';
}

export function drawInviteCard(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  plan: Plan,
): void {
  const approved = plan.approval === 'approved';
  cardBody(c, w, h, COLORS.link);
  label(c, 'INVITE DRAFT', COLORS.link);
  const inner = w - PAD * 2;

  if (!plan.invite) {
    font(c, 28);
    c.fillStyle = COLORS.muted;
    drawWrapped(c, 'Nothing to send until there is a free time.', PAD, 130, inner, 36, 3);
    return;
  }

  pill(
    c,
    approved ? 'APPROVED' : 'NEEDS APPROVAL',
    w - PAD,
    30,
    approved ? COLORS.green : COLORS.amber,
    COLORS.ink,
    20,
    true,
  );

  font(c, 24, 500);
  c.fillStyle = COLORS.faint;
  c.fillText('To', PAD, 112);
  c.fillStyle = COLORS.muted;
  c.fillText(plan.invite.to, PAD + 44, 112);

  font(c, 28, 700);
  c.fillStyle = COLORS.text;
  let y = drawWrapped(c, plan.invite.subject, PAD, 156, inner, 36, 2);

  c.fillStyle = COLORS.line;
  c.fillRect(PAD, y - 14, inner, 2);
  y += 22;

  font(c, 26);
  c.fillStyle = COLORS.muted;
  const bottom = approved ? h - 76 : h - PAD;
  for (const para of plan.invite.body.split('\n')) {
    if (para === '') {
      y += 12;
      continue;
    }
    const room = Math.floor((bottom - y) / 33) + 1;
    if (room <= 0) break;
    y = drawWrapped(c, para, PAD, y, inner, 33, room);
  }

  if (approved) {
    const bandH = 58;
    c.save();
    roundRect(c, 3, 3, w - 6, h - 6, 26);
    c.clip();
    c.fillStyle = 'rgba(90, 209, 154, 0.92)';
    c.fillRect(0, h - bandH - 3, w, bandH + 3);
    c.restore();
    font(c, 24, 700);
    c.fillStyle = COLORS.ink;
    c.fillText('✓ In the demo outbox · not really sent', PAD, h - 22);
  }
}

/** Amber halo drawn behind the invite while it needs approval. */
export function drawGlow(c: CanvasRenderingContext2D, w: number, h: number, inset: number): void {
  c.shadowColor = COLORS.amber;
  c.shadowBlur = inset * 0.8;
  c.lineWidth = 8;
  c.strokeStyle = COLORS.amber;
  roundRect(c, inset, inset, w - inset * 2, h - inset * 2, 30);
  c.stroke();
}

/** One preset chip. Looks: normal, hover, active (its rule is on), disabled, listening, busy. */
export function drawChip(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  label: string,
  look: 'normal' | 'hover' | 'active' | 'disabled' | 'listening' | 'busy',
): void {
  const styles = {
    normal: { bg: 'rgba(127, 178, 255, 0.14)', line: 'rgba(127, 178, 255, 0.55)', fg: COLORS.text },
    hover: { bg: 'rgba(127, 178, 255, 0.4)', line: COLORS.link, fg: COLORS.text },
    active: { bg: COLORS.link, line: COLORS.link, fg: COLORS.ink },
    disabled: { bg: 'rgba(255, 255, 255, 0.04)', line: COLORS.line, fg: COLORS.faint },
    listening: { bg: '#e5534b', line: '#ff8a80', fg: '#ffffff' },
    busy: { bg: 'rgba(242, 184, 75, 0.25)', line: COLORS.amber, fg: COLORS.text },
  }[look];
  roundRect(c, 2, 2, w - 4, h - 4, (h - 4) / 2);
  c.fillStyle = styles.bg;
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = styles.line;
  c.stroke();
  font(c, CHIP_FONT_PX, 600);
  c.fillStyle = styles.fg;
  c.textBaseline = 'middle';
  c.fillText(label, (w - c.measureText(label).width) / 2, h / 2 + 1);
  c.textBaseline = 'alphabetic';
}

export const CHIP_FONT_PX = 22;

export interface OutboxView {
  subject: string;
}

export function drawTray(c: CanvasRenderingContext2D, w: number, h: number, items: OutboxView[]): void {
  roundRect(c, 2, 2, w - 4, h - 4, 18);
  c.fillStyle = 'rgba(255, 255, 255, 0.05)';
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = COLORS.line;
  c.stroke();

  font(c, 22, 700);
  c.fillStyle = COLORS.green;
  c.textBaseline = 'middle';
  const title = `DEMO OUTBOX · ${items.length}`;
  c.fillText(title, 24, h / 2);
  let x = 24 + c.measureText(title).width + 24;

  font(c, 22);
  const note = 'Nothing is really sent';
  const noteW = c.measureText(note).width;
  c.fillStyle = COLORS.faint;
  c.fillText(note, w - 24 - noteW, h / 2);
  const maxX = w - 24 - noteW - 24;

  if (items.length === 0) {
    c.fillStyle = COLORS.muted;
    c.fillText('Pinch and hold the invite for 1 second to approve it.', x, h / 2);
  } else {
    // Newest first, as chips, until the row is full.
    font(c, 22, 500);
    for (const item of items) {
      const text = `✓ ${item.subject.replace(/^App test call: /, '')}`;
      const tw = c.measureText(text).width + 28;
      if (x + tw > maxX) break;
      roundRect(c, x, h / 2 - 20, tw, 40, 20);
      c.fillStyle = 'rgba(90, 209, 154, 0.18)';
      c.fill();
      c.fillStyle = COLORS.text;
      c.fillText(text, x + 14, h / 2 + 1);
      x += tw + 10;
    }
  }
  c.textBaseline = 'alphabetic';
}
