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
  /** The time on this card is busy now: the reason. The card is blocked and cannot be approved. */
  conflict: string | null;
  /** A replacement on trial: the old and the new time, read together on the card. */
  change?: { was: string; now: string } | null;
}

const RED = '#e5534b';

/** Text on one line, shrunk until it fits. */
function fitText(c: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight: number, min = 14): void {
  font(c, size, weight);
  while (size > min && c.measureText(text).width > maxW) font(c, --size, weight);
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
  const blocked = x.conflict !== null;
  const sent = approved && !sending && x.receipt !== null && !blocked;
  const change = !blocked && !approved ? (x.change ?? null) : null;
  cardBody(c, w, h, blocked ? RED : COLORS.link);
  // Focus time and a moved meeting are both changes on your own calendar, not emails.
  const focus = isFocus(plan) || !!plan.moving;
  label(
    c,
    blocked
      ? focus
        ? 'OLD BLOCK'
        : 'OLD INVITE'
      : sent
        ? focus
          ? 'SAVED TO DEMO CALENDAR'
          : 'SENT TO DEMO OUTBOX'
        : change
          ? 'REPLACEMENT'
          : focus
            ? 'CALENDAR BLOCK'
            : 'INVITE DRAFT',
    blocked ? '#ff9a90' : sent ? COLORS.green : COLORS.link,
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
    blocked ? '✕ BLOCKED' : sent ? 'SENT · DEMO' : sending ? 'SENDING' : approved ? 'APPROVED' : 'NEEDS APPROVAL',
    w - PAD,
    30,
    blocked ? RED : approved ? COLORS.green : COLORS.amber,
    blocked ? '#ffffff' : COLORS.ink,
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
    c.fillStyle = blocked ? COLORS.faint : COLORS.text;
    let y = drawWrapped(c, plan.invite.subject, PAD, 156, inner, 36, 2);

    if (change) {
      // Before and after on one line, so both are read together (also in the lap fallback).
      const was = `WAS ${change.was}`;
      const now = `  →  NOW ${change.now}`;
      let size = 26;
      const width = () => {
        font(c, size, 600);
        const a = c.measureText(was).width;
        font(c, size, 800);
        return a + c.measureText(now).width;
      };
      while (size > 16 && width() > inner) size--;
      font(c, size, 600);
      c.fillStyle = COLORS.faint;
      c.fillText(was, PAD, y + 6);
      const wasW = c.measureText(was).width;
      c.fillRect(PAD, y + 6 - size * 0.32, wasW, 2); // struck out: the old time
      font(c, size, 800);
      c.fillStyle = COLORS.text;
      c.fillText(now, PAD + wasW, y + 6);
      y += 40;
      if (x.tradeOff) {
        // Pale, not amber: amber is kept for the decision itself (the pill, the glow, the ring).
        font(c, 23, 600);
        c.fillStyle = '#cfe0ff';
        y = drawWrapped(c, `↔ ${x.tradeOff}`, PAD, y, inner, 30, 2) + 4;
      }
    } else if (x.tradeOff && !approved && !blocked) {
      // Not on a blocked card: its time no longer fits, and nothing on it waits for a decision.
      font(c, 24, 700);
      c.fillStyle = COLORS.amber;
      y = drawWrapped(c, `⚠ ${x.tradeOff}`, PAD, y + 4, inner, 30, 2) + 4;
    }

    c.fillStyle = COLORS.line;
    c.fillRect(PAD, y - 14, inner, 2);
    y += 22;

    font(c, 26);
    c.fillStyle = sending || blocked ? COLORS.faint : COLORS.muted;
    const bottom = h - (blocked ? 124 : 80);
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
  const band = (fill: string, text: string, ink: string, second = '') => {
    const bandH = second ? 100 : 64;
    c.save();
    roundRect(c, 3, 3, w - 6, h - 6, 26);
    c.clip();
    c.fillStyle = fill;
    c.fillRect(0, h - bandH - 3, w, bandH + 3);
    c.restore();
    fitText(c, text, inner, 26, 800);
    c.fillStyle = ink;
    c.fillText(text, PAD, h - (second ? 60 : 24));
    if (second) {
      fitText(c, second, inner, 23, 600);
      c.fillText(second, PAD, h - 24);
    }
  };
  if (x.conflict) band('rgba(229, 83, 75, 0.95)', `✕ ${x.conflict}`, '#ffffff', 'Nothing can be sent from this. Pick a time on the wall.');
  else if (sending) band('rgba(90, 209, 154, 0.95)', `Sending in ${x.sendingLeft} s · pinch to Unsend`, COLORS.ink);
  else if (sent) band('rgba(90, 209, 154, 0.25)', '✓ Nothing was really sent (demo)', COLORS.green);
  else if (!approved) {
    band('rgba(242, 184, 75, 0.22)', change ? `Pinch and hold 1 s to approve ${change.now}` : 'Pinch and hold 1 s to approve', COLORS.amber);
  }
}

/** One of the two big "try this time" targets on the wall during a conflict review. */
export function drawCandidate(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  cand: { label: string; why: string },
  look: 'idle' | 'hover' | 'trial',
): void {
  roundRect(c, 3, 3, w - 6, h - 6, 18);
  c.fillStyle = look === 'trial' ? COLORS.amber : look === 'hover' ? 'rgba(127, 178, 255, 0.42)' : 'rgba(127, 178, 255, 0.16)';
  c.fill();
  c.lineWidth = 4;
  c.strokeStyle = look === 'trial' ? COLORS.amber : COLORS.link;
  c.stroke();
  c.textBaseline = 'middle';
  fitText(c, cand.label, w - 28, 30, 800, 18);
  c.fillStyle = look === 'trial' ? COLORS.ink : COLORS.text;
  c.fillText(cand.label, (w - c.measureText(cand.label).width) / 2, h * 0.38);
  const sub = look === 'trial' ? 'on trial · hold the card' : `try · ${cand.why}`;
  fitText(c, sub, w - 24, 18, 600, 12);
  c.fillStyle = look === 'trial' ? COLORS.ink : COLORS.muted;
  c.fillText(sub, (w - c.measureText(sub).width) / 2, h * 0.72);
  c.textBaseline = 'alphabetic';
}

/** The review bar's words: the conflict, its reason, and what the agent understood. */
export function drawReviewBar(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  v: { title: string; reason: string; detail: string; note: string; noteAi: boolean },
  textW: number,
): void {
  roundRect(c, 2, 2, w - 4, h - 4, 18);
  c.fillStyle = 'rgba(22, 24, 30, 0.97)';
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = RED;
  c.stroke();
  // The visual mark: a red bar and a cross, besides the word itself.
  c.fillStyle = RED;
  roundRect(c, 2, 2, 12, h - 4, 6);
  c.fill();
  fitText(c, `✕ ${v.title}`, textW, 17, 800, 12);
  c.fillStyle = '#ff9a90';
  c.fillText(`✕ ${v.title}`, 26, 26);
  // The reason stays large: it wraps onto a second line instead of shrinking.
  font(c, 21, 800);
  c.fillStyle = COLORS.text;
  const y = drawWrapped(c, v.reason, 26, 51, textW, 24, 2);
  const second = v.note || v.detail;
  fitText(c, second, textW, 16, 600, 11);
  c.fillStyle = v.note && v.noteAi ? COLORS.link : COLORS.muted;
  c.fillText(second, 26, Math.min(y + 2, h - 10));
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
  /** A short label, e.g. "Wed 18 Nov, 5:30 PM"; the subject is used when there is none. */
  short?: string;
  /** Set for history that must not be used: "CONFLICT", "REPLACED", "BLOCKED". */
  blocked?: string;
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
  const title = `DEMO OUTBOX · ${items.filter((i) => !i.blocked).length}`;
  c.fillText(title, 24, h / 2);
  let x = 24 + c.measureText(title).width + 24;

  font(c, 22);
  const note = 'Nothing is really sent';
  const noteW = c.measureText(note).width;
  // History (a blocked or replaced item) must stay in sight: it gets the note's room.
  const history = items.some((i) => i.blocked);
  if (!history) {
    c.fillStyle = COLORS.faint;
    c.fillText(note, w - 24 - noteW, h / 2);
  }
  const maxX = history ? w - 20 : w - 24 - noteW - 24;

  if (items.length === 0) {
    c.fillStyle = COLORS.muted;
    c.fillText('Pinch and hold the invite for 1 second to approve it.', x, h / 2);
  } else {
    // Newest first, as chips, until the row is full.
    font(c, 22, 500);
    for (const item of items) {
      const what = item.short ?? item.subject.replace(/^App test call: /, '');
      let text = item.blocked ? `✕ ${item.blocked} · ${what}` : `✓ ${what}`;
      // History stays in sight: a chip that does not fit is cut, not dropped (down to a readable stub).
      while (text.length > 16 && x + c.measureText(text).width + 28 > maxX) text = `${text.slice(0, -2)}…`;
      const tw = c.measureText(text).width + 28;
      if (x + tw > maxX) break;
      roundRect(c, x, h / 2 - 20, tw, 40, 20);
      c.fillStyle = item.blocked ? 'rgba(229, 83, 75, 0.16)' : 'rgba(90, 209, 154, 0.18)';
      c.fill();
      if (item.blocked) {
        c.lineWidth = 2;
        c.strokeStyle = RED;
        c.stroke();
      }
      c.fillStyle = item.blocked ? COLORS.muted : COLORS.text;
      c.fillText(text, x + 14, h / 2 + 1);
      x += tw + 10;
    }
  }
  c.textBaseline = 'alphabetic';
}
