import { describe, expect, it } from 'vitest';
import calendarJson from '../src/data/sample-calendar.json';
import { cardScale, chooseDesk, DESK, faceEyes, lapPlacement } from '../src/logic/desk.js';
import type { PlaneInput } from '../src/logic/placement.js';
import { approve, buildReceipt, makePlan, unapprove } from '../src/logic/plan.js';
import { freeSlots, schedule, type CalendarData } from '../src/logic/scheduler.js';
import { exampleBlock, withExample } from '../src/logic/example-change.js';
import { tradeOff, weekModel } from '../src/logic/week.js';

const cal = calendarJson as CalendarData;
const at = (h: number, m = 0) => h * 60 + m;
const cell = (m: ReturnType<typeof weekModel>, day: string, start: number) =>
  m.cells.find((c) => c.day === day && c.start === start)!;
const MON = '2026-11-16';
const TUE = '2026-11-17';
const WED = '2026-11-18';

describe('weekModel: why each half hour can or cannot be used', () => {
  const m = weekModel(cal);

  it('covers 5 days x 18 half hours, with every busy block', () => {
    expect(m.cells).toHaveLength(90);
    expect(m.blocks).toHaveLength(cal.busy.owner.length + cal.busy.guest.length);
  });

  it('gives a reason for every cell', () => {
    expect(cell(m, MON, at(9)).kind).toBe('past'); // now is Mon 9:00 + 30 min notice
    expect(cell(m, MON, at(9, 30))).toMatchObject({ kind: 'busy', reason: 'You · Sprint planning' });
    expect(cell(m, MON, at(12, 30))).toMatchObject({ kind: 'buffer', reason: 'too close to Sprint planning' });
    expect(cell(m, TUE, at(11))).toMatchObject({ kind: 'busy', reason: 'Sam · Class' });
    expect(cell(m, TUE, at(13))).toMatchObject({ kind: 'free' });
  });

  it('rule cells say which rule ruled them out', () => {
    const after4 = weekModel(cal, { after: at(16) });
    expect(cell(after4, TUE, at(13))).toMatchObject({ kind: 'rule', reason: 'before 4 PM rule' });
    const notWed = weekModel(cal, { notDays: [WED] });
    expect(cell(notWed, WED, at(17, 30))).toMatchObject({ kind: 'rule', reason: 'not Wed rule' });
    const thu = weekModel(cal, { day: '2026-11-19' });
    expect(cell(thu, TUE, at(13))).toMatchObject({ kind: 'rule', reason: 'only Thu rule' });
  });

  it('free cells are exactly the scheduler free slots', () => {
    for (const c of [{}, { after: at(16) }, { notDays: [WED] }]) {
      const model = weekModel(cal, c);
      expect(model.cells.filter((x) => x.kind === 'free').length).toBe(freeSlots(cal, c).length);
      expect(model.ruledOut).toBe(90 - freeSlots(cal, c).length);
    }
  });
});

describe('tradeOff: say the downside before the hold', () => {
  it('last half hour of the day', () => {
    expect(tradeOff(cal, schedule(cal, { after: at(16) }).best!)).toBe('Trade-off: last half hour of the workday.');
  });
  it('right after a busy block', () => {
    expect(tradeOff(cal, schedule(cal).best!)).toBe('Trade-off: only 15 min after your Lunch.');
  });
  it('the only time left', () => {
    const c = { before: at(13) };
    expect(tradeOff(cal, schedule(cal, c).best!, c)).toBe('Trade-off: the only time that fits this week.');
  });
  it('nothing to flag', () => {
    const c = { after: at(16), notDays: [WED] };
    const thu = schedule(cal, c).best!;
    expect(thu.id).toBe('2026-11-19T16:00');
    expect(tradeOff(cal, thu, c)).toBeNull();
  });
});

describe('chooseDesk: the invite goes to your real table, or your lap', () => {
  const head = { x: 0, y: 1.2, z: 0 };
  const fwd = { x: 0, y: 0, z: -1 };
  const table = (over: Partial<PlaneInput> = {}): PlaneInput => ({
    id: 7,
    position: { x: 0, y: 0.75, z: -0.6 },
    orientation: { x: 0, y: 0, z: 0, w: 1 }, // plane +Y = up
    polygon: [
      { x: -0.5, z: -0.3 },
      { x: 0.5, z: -0.3 },
      { x: 0.5, z: 0.3 },
      { x: -0.5, z: 0.3 },
    ],
    vertical: false,
    label: 'table',
    ...over,
  });

  it('puts the card on a table in front, a comfortable distance away, facing you, tilted up', () => {
    // The near edge is 30 cm away: 14 cm in from it (the old rule) was "way too close" on a Quest 3.
    const d = chooseDesk(head, fwd, [table()]);
    expect(d.kind).toBe('desk');
    expect(d.planeId).toBe(7);
    expect(d.position.x).toBeCloseTo(0);
    expect(d.position.z).toBeCloseTo(-0.6); // the table's centre: as far as this small table allows
    expect(d.position.y).toBeCloseTo(0.75 + DESK.lift);
    expect(d.yaw).toBeCloseTo(0);
    expect(d.tilt).toBeGreaterThan(0);
    // A deep desk: the card sits 65 cm ahead, not at the edge and not at the far centre.
    const deep = chooseDesk(head, fwd, [
      table({ position: { x: 0, y: 0.75, z: -1.0 }, polygon: [{ x: -0.8, z: -0.8 }, { x: 0.8, z: -0.8 }, { x: 0.8, z: 0.8 }, { x: -0.8, z: 0.8 }] }),
    ]);
    expect(deep.position.z).toBeCloseTo(-DESK.comfort);
    // A table whose near edge is already far enough: the usual 14 cm in from the edge.
    const far = chooseDesk(head, fwd, [table({ position: { x: 0, y: 0.75, z: -1.1 } })]);
    expect(far.position.z).toBeCloseTo(-0.8 - DESK.inset);
  });

  it('accepts "desk" and unlabelled tables, ignores floors, couches, far and behind tables', () => {
    expect(chooseDesk(head, fwd, [table({ label: 'desk' })]).kind).toBe('desk');
    expect(chooseDesk(head, fwd, [table({ label: undefined })]).kind).toBe('desk');
    expect(chooseDesk(head, fwd, [table({ label: 'couch' })]).kind).toBe('lap');
    expect(chooseDesk(head, fwd, [table({ position: { x: 0, y: 0, z: -0.6 }, label: undefined })]).kind).toBe('lap');
    expect(chooseDesk(head, fwd, [table({ position: { x: 0, y: 0.75, z: -3 } })]).kind).toBe('lap');
    expect(chooseDesk(head, fwd, [table({ position: { x: 0, y: 0.75, z: 0.8 } })]).kind).toBe('lap');
  });

  it('no table: about 80 cm from the eyes, low and leaning back, a little larger', () => {
    const l = lapPlacement(head, fwd);
    expect(l).toMatchObject({ kind: 'lap' });
    expect(l.position.z).toBeCloseTo(-0.62);
    expect(l.position.y).toBeCloseTo(0.68);
    expect(l.yaw).toBeCloseTo(0);
    // About 80 cm from the eyes (it was 57 cm, "way too close" on a Quest 3).
    const d = Math.hypot(l.position.z, l.position.y - head.y);
    expect(d).toBeGreaterThan(0.8);
    // Larger in the room, a little smaller in your view: the square root of the distance.
    expect(l.scale / DESK.baseScale).toBeCloseTo(Math.sqrt(d / DESK.scaleAt));
    expect(l.scale).toBeGreaterThan(0.64);
    expect(l.scale).toBeLessThan(0.67);
    expect(cardScale(head, { x: 0, y: 0.85, z: -0.45 })).toBeCloseTo(0.55, 2); // the old spot gives the old size
    expect(cardScale(head, { x: 0, y: 1.2, z: -9 })).toBe(DESK.maxScale);
    expect(cardScale(head, head)).toBe(DESK.minScale);
  });

  it('the card does not stand between a resting hand and the board', () => {
    // No table, the board floating 1.2 m ahead at eye height: its bottom edge is at 0.73 m.
    const l = lapPlacement(head, fwd);
    const half = (0.52 * l.scale) / 2; // half the card's height
    const top = { y: l.position.y + half * Math.cos(l.tilt), z: l.position.z - half * Math.sin(l.tilt) };
    // A ray from a hand resting in the lap (85 cm high, 30 cm ahead) to a point on the board:
    const rayY = (targetY: number) => 0.85 + ((targetY - 0.85) * (top.z + 0.3)) / (-1.2 + 0.3);
    expect(rayY(0.85)).toBeGreaterThan(top.y + 0.05); // the lowest row of the week clears the card by 5 cm
    expect(rayY(0.8)).toBeGreaterThan(top.y + 0.02); // so does the outbox tray
  });

  it('a card you drag turns to face your eyes wherever you take it', () => {
    const p = faceEyes(head, { x: 0.5, y: 0.9, z: -0.5 });
    expect(p.yaw).toBeCloseTo(Math.atan2(-0.5, 0.5)); // its front points back at the head
    expect(p.tilt).toBeCloseTo(Math.atan2(0.3, Math.hypot(0.5, 0.5)));
    // Above the eyes it stands upright; straight below them it leans back no further than the limit.
    expect(faceEyes(head, { x: 0, y: 1.6, z: -0.6 }).tilt).toBe(0);
    expect(faceEyes(head, { x: 0, y: 0.4, z: -0.01 }).tilt).toBe(DESK.maxTilt);
    expect(faceEyes(head, { x: 0, y: 0.4, z: 0 }).yaw).toBe(0); // straight below: no spin
  });
});

describe('receipt, Unsend and the agent keeping watch', () => {
  it('the receipt says what the rules, the AI and you each did', () => {
    const plan = makePlan(cal);
    const r = buildReceipt(cal, plan, weekModel(cal).ruledOut, '7:42 PM');
    expect(r.map((l) => l.tag)).toEqual(['RULES', 'RULES', 'RULES', 'YOU', 'DEMO']);
    expect(r[0].text).toBe('Read the sample week (Mon 16–Fri 20 Nov).');
    expect(r[2].text).toBe('Picked Tue 1:00 PM and wrote the email.');
    expect(r[3].text).toBe('Held to approve at 7:42 PM.');
    const ai = buildReceipt(cal, { ...plan, by: 'ai', invite: { ...plan.invite!, source: 'ai' } }, 1, 'x');
    expect(ai[2]).toEqual({ tag: 'AI', text: 'Picked Tue 1:00 PM and wrote the email.' });
  });

  it('Unsend puts the invite back to "needs approval"', () => {
    const approved = approve(makePlan(cal), 'x')!.plan;
    const back = unapprove(approved);
    expect(back.approval).toBe('needs');
    expect(back.version).toBe(approved.version + 1);
    expect(unapprove(back)).toBe(back);
  });

  it('the example change lands on the approved slot, and the agent finds a new one', () => {
    const slot = schedule(cal).best!;
    const changed = withExample(cal, [exampleBlock(cal, slot)]);
    const free = (c: CalendarData) => freeSlots(c).some((s) => s.id === slot.id);
    expect(free(cal)).toBe(true);
    expect(free(changed)).toBe(false);
    expect(schedule(changed).best!.id).not.toBe(slot.id);
    expect(cal.busy.owner).toHaveLength(11); // the original is untouched
  });
});
