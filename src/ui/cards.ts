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
    font(c, 22, 600);
    c.fillStyle = COLORS.faint;
    c.fillText('ALSO FREE', PAD, h - 128);
    let y = h - 112;
    for (const alt of plan.alternatives) {
      roundRect(c, PAD, y, inner, 44, 12);
      c.fillStyle = 'rgba(255, 255, 255, 0.06)';
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = COLORS.line;
      c.stroke();
      font(c, 24, 500);
      c.fillStyle = COLORS.text;
      c.fillText(shortSlot(alt), PAD + 16, y + 30);
      y += 52;
    }
  }
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
  const bottom = h - PAD;
  for (const para of plan.invite.body.split('\n')) {
    if (para === '') {
      y += 12;
      continue;
    }
    const room = Math.floor((bottom - y) / 33) + 1;
    if (room <= 0) break;
    y = drawWrapped(c, para, PAD, y, inner, 33, room);
  }
}
