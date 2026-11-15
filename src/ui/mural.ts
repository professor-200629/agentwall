/**
 * The week mural: Mon–Fri across the real wall. The agent "sweeps" the week
 * day by day, striking out every time it can't use (with the reason), then one
 * gold slot stays lit and the runner-ups are outlined.
 *
 * Pure canvas drawing: (context, size, model, progress) in, pixels out.
 */
import type { Slot } from '../logic/scheduler.js';
import { clock, dayLabel } from '../logic/scheduler.js';
import type { WeekCell, WeekModel } from '../logic/week.js';
import { COLORS, font, roundRect } from './canvas-panel.js';

/** Pixel layout of the mural canvas, shared with the board for hit targets. */
export const MURAL = {
  axisW: 70,
  headerH: 40,
  footerH: 70,
  padR: 10,
};

export interface MuralView {
  week: WeekModel;
  chosen: Slot | null;
  alternatives: Slot[];
  /** 0..1: how far the agent's sweep has got (1 = finished). */
  progress: number;
  reason: string;
  /** Who the reason line comes from: RULES, AI or YOU. */
  tag: string;
  /** Block ids (day+start) added by the sample change, drawn as NEW. */
  fresh: Set<string>;
  /** What the hand ray is over: a free time to pick, or a rule area to remove. */
  hover?: MuralHover | null;
}

export interface MuralHover {
  kind: 'pick' | 'rule';
  day: string;
  start: number;
  /** For a rule: its reason text; every cell with the same reason lights up. */
  reason: string;
  /** Short call to action, e.g. "Pinch: 2:30 PM" or "Pinch to remove: after 4 PM". */
  label: string;
}

export function muralGrid(w: number, h: number, week: WeekModel) {
  const rows = (week.dayEnd - week.dayStart) / week.step;
  const colW = (w - MURAL.axisW - MURAL.padR) / week.days.length;
  const rowH = (h - MURAL.headerH - MURAL.footerH) / rows;
  const x = (dayIndex: number) => MURAL.axisW + dayIndex * colW;
  const y = (min: number) => MURAL.headerH + ((min - week.dayStart) / week.step) * rowH;
  return { rows, colW, rowH, x, y };
}

const PERSON = {
  you: { fill: 'rgba(95, 135, 210, 0.55)', line: 'rgba(140, 175, 240, 0.9)' },
  guest: { fill: 'rgba(160, 105, 200, 0.55)', line: 'rgba(200, 150, 240, 0.9)' },
};
const AGENT_BLOCK = { fill: 'rgba(70, 170, 120, 0.6)', line: 'rgba(120, 220, 160, 0.95)' };
const STRIKE = 'rgba(255, 90, 80, 0.95)';
const GOLD = '#f5c542';

function hatch(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  c.strokeStyle = color;
  c.lineWidth = 2;
  for (let i = -h; i < w; i += 12) {
    c.beginPath();
    c.moveTo(x + i, y + h);
    c.lineTo(x + i + h, y);
    c.stroke();
  }
  c.restore();
}

/** Group consecutive cells of the same kind and reason in one day (for labels). */
function runs(cells: WeekCell[]): Array<{ first: WeekCell; count: number }> {
  const out: Array<{ first: WeekCell; count: number }> = [];
  for (const cell of cells) {
    const last = out[out.length - 1];
    if (last && last.first.kind === cell.kind && last.first.reason === cell.reason) last.count++;
    else out.push({ first: cell, count: 1 });
  }
  return out;
}

export function drawMural(c: CanvasRenderingContext2D, w: number, h: number, v: MuralView): void {
  const { week } = v;
  const g = muralGrid(w, h, week);
  const days = week.days.length;
  // Days the sweep has reached; the chosen slot lights up only at the end.
  const scanned = Math.min(days, Math.floor(v.progress * (days + 1)));
  const done = v.progress >= 1;

  // Panel.
  roundRect(c, 2, 2, w - 4, h - 4, 22);
  c.fillStyle = COLORS.card;
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = COLORS.line;
  c.stroke();

  // Day headers.
  font(c, 22, 700);
  c.textBaseline = 'middle';
  week.days.forEach((day, i) => {
    const label = dayLabel(day).short.replace(/ [A-Z][a-z]{2}$/, ''); // "Mon 16"
    c.fillStyle = i < scanned ? COLORS.text : COLORS.muted;
    c.fillText(label, g.x(i) + 10, MURAL.headerH / 2 + 2);
  });
  // Time axis (full hours).
  font(c, 16, 500);
  c.fillStyle = COLORS.faint;
  for (let m = week.dayStart; m <= week.dayEnd; m += 60) {
    const t = clock(m).replace(':00', '');
    c.fillText(t, 10, g.y(m));
    c.fillStyle = 'rgba(255,255,255,0.08)';
    c.fillRect(MURAL.axisW, g.y(m), w - MURAL.axisW - MURAL.padR, 1);
    c.fillStyle = COLORS.faint;
  }

  // Cells: past / rule / buffer backgrounds, labelled per run once the day is scanned.
  week.days.forEach((day, i) => {
    const cells = week.cells.filter((cell) => cell.day === day);
    for (const run of runs(cells)) {
      const x0 = g.x(i) + 3;
      const y0 = g.y(run.first.start) + 1;
      const cw = g.colW - 6;
      const ch = g.rowH * run.count - 2;
      const k = run.first.kind;
      if (k === 'free' || k === 'busy') continue;
      c.fillStyle = k === 'buffer' ? 'rgba(255, 90, 80, 0.10)' : k === 'short' ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.04)';
      c.fillRect(x0, y0, cw, ch);
      if (i < scanned) {
        hatch(c, x0, y0, cw, ch, k === 'rule' ? 'rgba(242, 184, 75, 0.35)' : 'rgba(255,255,255,0.10)');
        if (run.count >= 2 && k !== 'buffer') {
          font(c, 16, 600);
          c.fillStyle = k === 'rule' ? COLORS.amber : COLORS.faint;
          c.fillText(run.first.reason, x0 + 8, y0 + Math.min(ch / 2, 18));
        }
      }
    }
  });

  // Busy blocks (you / guest), struck out in red once the sweep reaches them.
  for (const b of week.blocks) {
    const i = week.days.indexOf(b.day);
    if (i < 0) continue;
    const x0 = g.x(i) + 6;
    const y0 = g.y(Math.max(b.start, week.dayStart)) + 2;
    const y1 = g.y(Math.min(b.end, week.dayEnd)) - 2;
    if (y1 <= y0) continue;
    const bw = g.colW - 12;
    const isFresh = v.fresh.has(`${b.day}T${b.start}`);
    // Blocks the agent added (with your yes) are green: "Prep (agent)".
    const p = b.title.endsWith('(agent)') ? AGENT_BLOCK : PERSON[b.who];
    roundRect(c, x0, y0, bw, y1 - y0, 8);
    c.fillStyle = isFresh ? 'rgba(255, 90, 80, 0.55)' : p.fill;
    c.fill();
    c.lineWidth = isFresh ? 4 : 2;
    c.strokeStyle = isFresh ? STRIKE : p.line;
    c.stroke();
    font(c, y1 - y0 > 30 ? 17 : 15, 600);
    c.fillStyle = COLORS.text;
    const who = b.who === 'you' ? 'You' : 'Sam';
    let text = `${who} · ${b.title}`;
    while (text.length > 4 && c.measureText(text).width > bw - 14) text = `${text.slice(0, -2)}…`;
    c.fillText(text, x0 + 7, y0 + Math.min((y1 - y0) / 2, 15));
    if (isFresh) {
      font(c, 14, 800);
      c.fillStyle = '#ffd5d0';
      c.fillText('NEW', x0 + bw - 40, y0 + Math.min((y1 - y0) / 2, 15));
    }
    if (i < scanned && !isFresh) {
      c.strokeStyle = STRIKE;
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(x0 + 4, y1 - 4);
      c.lineTo(x0 + bw - 4, y0 + 4);
      c.stroke();
    }
  }

  // Sweep line on the day being checked.
  if (!done && scanned < days) {
    c.fillStyle = 'rgba(245, 197, 66, 0.20)';
    c.fillRect(g.x(scanned), MURAL.headerH, g.colW, g.rows * g.rowH);
    c.fillStyle = GOLD;
    c.fillRect(g.x(scanned), MURAL.headerH, 4, g.rows * g.rowH);
  }

  // Runner-ups outlined; the chosen slot in gold (only when the sweep is done).
  if (done) {
    for (const alt of v.alternatives) {
      const i = week.days.indexOf(alt.day);
      if (i < 0) continue;
      c.setLineDash([8, 6]);
      c.lineWidth = 3;
      c.strokeStyle = COLORS.link;
      const altRows = Math.max(1, (alt.end - alt.start) / week.step);
      roundRect(c, g.x(i) + 4, g.y(alt.start) + 1, g.colW - 8, g.rowH * altRows - 2, 6);
      c.stroke();
      c.setLineDash([]);
    }
    if (v.chosen) {
      const i = week.days.indexOf(v.chosen.day);
      if (i >= 0) {
        const x0 = g.x(i) + 3;
        const y0 = g.y(v.chosen.start);
        c.shadowColor = GOLD;
        c.shadowBlur = 22;
        // A 2-hour focus block spans its four rows.
        roundRect(c, x0, y0, g.colW - 6, g.rowH * Math.max(1, (v.chosen.end - v.chosen.start) / week.step), 7);
        c.fillStyle = GOLD;
        c.fill();
        c.shadowBlur = 0;
        font(c, 17, 800);
        c.fillStyle = COLORS.ink;
        c.fillText(`★ ${clock(v.chosen.start)}`, x0 + 8, y0 + g.rowH / 2 + 1);
      }
    }
  }

  // Hand ray hover: the free time you would pick, or the whole rule you would remove.
  if (done && v.hover) {
    const hv = v.hover;
    const cells =
      hv.kind === 'rule'
        ? week.cells.filter((cell) => cell.kind === 'rule' && cell.reason === hv.reason)
        : week.cells.filter((cell) => cell.day === hv.day && cell.start === hv.start);
    const color = hv.kind === 'rule' ? COLORS.amber : COLORS.link;
    for (const cell of cells) {
      const i = week.days.indexOf(cell.day);
      const x0 = g.x(i) + 3;
      const y0 = g.y(cell.start) + 1;
      c.fillStyle = hv.kind === 'rule' ? 'rgba(242, 184, 75, 0.22)' : 'rgba(127, 178, 255, 0.30)';
      c.fillRect(x0, y0, g.colW - 6, g.rowH - 2);
    }
    // Outline the hovered cell itself and label it.
    const i = week.days.indexOf(hv.day);
    if (i >= 0) {
      const x0 = g.x(i) + 3;
      const y0 = g.y(hv.start) + 1;
      c.lineWidth = 4;
      c.strokeStyle = color;
      roundRect(c, x0, y0, g.colW - 6, g.rowH - 2, 6);
      c.stroke();
      font(c, 17, 800);
      const tw = c.measureText(hv.label).width + 16;
      const lx = Math.min(Math.max(x0, MURAL.axisW), w - MURAL.padR - tw);
      const ly = y0 - 28 < MURAL.headerH ? y0 + g.rowH + 2 : y0 - 28;
      roundRect(c, lx, ly, tw, 26, 13);
      c.fillStyle = color;
      c.fill();
      c.fillStyle = COLORS.ink;
      c.textBaseline = 'middle';
      c.fillText(hv.label, lx + 8, ly + 14);
      c.textBaseline = 'middle';
    }
  }

  // Footer: legend + the agent's reason.
  const fy = h - MURAL.footerH;
  font(c, 15, 700);
  const legend: Array<[string, string]> = [
    [PERSON.you.fill, 'You busy'],
    [PERSON.guest.fill, 'Sam busy'],
    ['rgba(242, 184, 75, 0.6)', 'Your rule (pinch to remove)'],
    [GOLD, 'Agent pick'],
  ];
  let lx = MURAL.axisW;
  for (const [color, text] of legend) {
    c.fillStyle = color;
    c.fillRect(lx, fy + 14, 16, 16);
    c.fillStyle = COLORS.muted;
    c.fillText(text, lx + 22, fy + 23);
    lx += c.measureText(text).width + 52;
  }
  font(c, 15, 700);
  c.fillStyle = COLORS.faint;
  c.fillText(`${week.ruledOut} half hours ruled out`, lx + 6, fy + 23);

  if (done && v.reason) {
    font(c, 15, 800);
    const tagW = c.measureText(v.tag).width + 16;
    roundRect(c, MURAL.axisW, fy + 38, tagW, 24, 12);
    c.fillStyle = v.tag === 'AI' ? COLORS.link : v.tag === 'YOU' ? COLORS.green : 'rgba(255,255,255,0.25)';
    c.fill();
    c.fillStyle = COLORS.ink;
    c.fillText(v.tag, MURAL.axisW + 8, fy + 51);
    font(c, 22, 600);
    c.fillStyle = COLORS.text;
    let r = v.reason;
    const maxW = w - MURAL.axisW - tagW - 30;
    while (r.length > 4 && c.measureText(r).width > maxW) r = `${r.slice(0, -2)}…`;
    c.fillText(r, MURAL.axisW + tagW + 12, fy + 51);
  } else if (!done) {
    font(c, 22, 600);
    c.fillStyle = GOLD;
    c.fillText('Agent is checking the week…', MURAL.axisW, fy + 51);
  }
  c.textBaseline = 'alphabetic';
}
