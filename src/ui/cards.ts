/**
 * Drawing for the two linked cards. Pure canvas code: (context, size, plan) in,
 * pixels out. Layout numbers are canvas pixels.
 */
import { isFocus } from '../logic/focus.js';
import type { Plan, ReceiptLine } from '../logic/plan.js';
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
  c.fillText(clockRange(plan.slot.start, plan.slot.end), PAD, 224);
  font(c, 26);
  c.fillStyle = COLORS.muted;
  c.fillText(`${cal.timezone} · ${plan.slot.end - plan.slot.start} min · you + ${cal.guest.name}`, PAD, 260);

  font(c, 26);
  c.fillStyle = COLORS.muted;
  drawWrapped(c, plan.reason, PAD, 304, inner, 32, 2);

  if (plan.alternatives.length > 0) {
    // The rows themselves are separate pinchable meshes (see ALT_ROW).
    font(c, 22, 600);
    c.fillStyle = COLORS.faint;
    c.fillText('ALSO FREE · PINCH TO USE', PAD, h - ALT_ROW.labelFromBottomPx);
  }
}

/** Pixel layout of the "Also free" rows, shared with the board so meshes line up. */
// Bigger hand-ray targets (code review 14 Nov): 58 px = 5.7 cm rows, 14 px gap.
export const ALT_ROW = {
  heightPx: 58,
  gapPx: 14,
  padPx: PAD,
  labelFromBottomPx: PAD + 58 * 2 + 14 + 16,
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
  c.textBaseline = 'middle';
  // The pill sits on its own day column of the mural, so the time alone is enough;
  // "Thu 19 Nov · 4:00 PM" does not fit a 20 cm pill.
  const icon = '⇄';
  font(c, 24, 800);
  const iconW = c.measureText(icon).width;
  let size = 26;
  const label = clock(slot.start);
  font(c, size, 700);
  while (size > 14 && c.measureText(label).width > w - 36 - iconW) font(c, --size, 700);
  c.fillStyle = COLORS.text;
  c.fillText(label, 12, h / 2 + 1);
  font(c, 24, 800);
  c.fillStyle = COLORS.link;
  c.fillText(icon, w - 12 - iconW, h / 2 + 1);
  c.textBaseline = 'alphabetic';
}

/** Extra state the desk invite card can show besides the plan itself. */
export interface InviteExtras {
  tradeOff: string | null;
  /** Seconds left in the Unsend window, or null when not sending. */
  sendingLeft: number | null;
  /** Receipt lines once sent. */
  receipt: ReceiptLine[] | null;
  /** Conflict banner (the agent noticed the sample week changed). */
  conflict: string | null;
}

const TAG_COLOR: Record<ReceiptLine['tag'], string> = {
  RULES: 'rgba(255,255,255,0.28)',
  AI: COLORS.link,
  YOU: COLORS.green,
  DEMO: COLORS.amber,
};

export function drawInviteCard(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  plan: Plan,
  x: InviteExtras = { tradeOff: null, sendingLeft: null, receipt: null, conflict: null },
): void {
  const approved = plan.approval === 'approved';
  const sending = approved && x.sendingLeft !== null;
  const sent = approved && !sending && x.receipt !== null;
  cardBody(c, w, h, x.conflict ? '#e5534b' : COLORS.link);
  const focus = isFocus(plan);
  label(
    c,
    sent ? (focus ? 'SAVED TO DEMO CALENDAR' : 'SENT TO DEMO OUTBOX') : focus ? 'CALENDAR BLOCK' : 'INVITE DRAFT',
    sent ? COLORS.green : COLORS.link,
  );
  const inner = w - PAD * 2;

  if (!plan.invite) {
    font(c, 28);
    c.fillStyle = COLORS.muted;
    drawWrapped(c, 'Nothing to send until there is a free time.', PAD, 130, inner, 36, 3);
    return;
  }

  pill(
    c,
    sent ? 'SENT · DEMO' : sending ? 'SENDING' : approved ? 'APPROVED' : 'NEEDS APPROVAL',
    w - PAD,
    30,
    approved ? COLORS.green : COLORS.amber,
    COLORS.ink,
    20,
    true,
  );

  if (sent && x.receipt) {
    // Receipt: who did what, tagged RULES / AI / YOU / DEMO.
    font(c, 26, 700);
    c.fillStyle = COLORS.text;
    let y = drawWrapped(c, plan.invite.subject, PAD, 112, inner, 34, 2) + 8;
    for (const line of x.receipt) {
      font(c, 18, 800);
      const tw = c.measureText(line.tag).width + 18;
      roundRect(c, PAD, y - 22, tw, 30, 15);
      c.fillStyle = TAG_COLOR[line.tag];
      c.fill();
      c.fillStyle = COLORS.ink;
      c.fillText(line.tag, PAD + 9, y);
      font(c, 23);
      c.fillStyle = COLORS.muted;
      y = drawWrapped(c, line.text, PAD + tw + 12, y, inner - tw - 12, 30, 2) + 12;
    }
  } else {
    font(c, 24, 500);
    c.fillStyle = COLORS.faint;
    c.fillText(focus ? 'On' : 'To', PAD, 112);
    c.fillStyle = COLORS.muted;
    c.fillText(plan.invite.to, PAD + 44, 112);

    font(c, 28, 700);
    c.fillStyle = COLORS.text;
    let y = drawWrapped(c, plan.invite.subject, PAD, 156, inner, 36, 2);

    if (x.tradeOff && !approved) {
      font(c, 24, 700);
      c.fillStyle = COLORS.amber;
      y = drawWrapped(c, `⚠ ${x.tradeOff}`, PAD, y + 4, inner, 30, 2) + 4;
    }

    c.fillStyle = COLORS.line;
    c.fillRect(PAD, y - 14, inner, 2);
    y += 22;

    font(c, 26);
    c.fillStyle = sending ? COLORS.faint : COLORS.muted;
    const bottom = h - (approved || !x.conflict ? 80 : 120);
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

  // Bottom band: what to do next.
  const bandH = 64;
  const band = (fill: string, text: string, ink: string) => {
    c.save();
    roundRect(c, 3, 3, w - 6, h - 6, 26);
    c.clip();
    c.fillStyle = fill;
    c.fillRect(0, h - bandH - 3, w, bandH + 3);
    c.restore();
    font(c, 26, 800);
    c.fillStyle = ink;
    c.fillText(text, PAD, h - 24);
  };
  if (x.conflict) band('rgba(229, 83, 75, 0.95)', `⚠ ${x.conflict}`, '#ffffff');
  else if (sending) band('rgba(90, 209, 154, 0.95)', `Sending in ${x.sendingLeft} s · pinch to Unsend`, COLORS.ink);
  else if (sent) band('rgba(90, 209, 154, 0.25)', '✓ Nothing was really sent (demo)', COLORS.green);
  else if (!approved) band('rgba(242, 184, 75, 0.22)', 'Pinch and hold 1 s to approve', COLORS.amber);
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

export const CHIP_FONT_PX = 24;

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
