import { describe, expect, it } from 'vitest';
import calendarJson from '../src/data/sample-calendar.json';
import { chooseDesk, DESK, lapPlacement } from '../src/logic/desk.js';
import type { PlaneInput } from '../src/logic/placement.js';
import { approve, buildReceipt, makePlan, unapprove } from '../src/logic/plan.js';
import { freeSlots, schedule, type CalendarData } from '../src/logic/scheduler.js';
import { sampleChange, stillFree, withGuestBusy } from '../src/logic/watch.js';
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

  it('puts the card on the near edge of a table in front, facing you, tilted up', () => {
    const d = chooseDesk(head, fwd, [table()]);
    expect(d.kind).toBe('desk');
    expect(d.planeId).toBe(7);
    expect(d.position.x).toBeCloseTo(0);
    expect(d.position.z).toBeCloseTo(-0.3 - DESK.inset);
    expect(d.position.y).toBeCloseTo(0.75 + DESK.lift);
    expect(d.yaw).toBeCloseTo(0);
    expect(d.tilt).toBeGreaterThan(0);
  });

  it('accepts "desk" and unlabelled tables, ignores floors, couches, far and behind tables', () => {
    expect(chooseDesk(head, fwd, [table({ label: 'desk' })]).kind).toBe('desk');
    expect(chooseDesk(head, fwd, [table({ label: undefined })]).kind).toBe('desk');
    expect(chooseDesk(head, fwd, [table({ label: 'couch' })]).kind).toBe('lap');
    expect(chooseDesk(head, fwd, [table({ position: { x: 0, y: 0, z: -0.6 }, label: undefined })]).kind).toBe('lap');
    expect(chooseDesk(head, fwd, [table({ position: { x: 0, y: 0.75, z: -3 } })]).kind).toBe('lap');
    expect(chooseDesk(head, fwd, [table({ position: { x: 0, y: 0.75, z: 0.8 } })]).kind).toBe('lap');
  });

  it('lap spot: 45 cm ahead, 35 cm below the eyes', () => {
    const l = lapPlacement(head, fwd);
    expect(l).toMatchObject({ kind: 'lap' });
    expect(l.position.z).toBeCloseTo(-0.45);
    expect(l.position.y).toBeCloseTo(0.85);
    expect(l.yaw).toBeCloseTo(0);
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

  it('the sample change lands on the approved slot, and the agent finds a new one', () => {
    const slot = schedule(cal).best!;
    const changed = withGuestBusy(cal, sampleChange(slot));
    expect(stillFree(cal, slot)).toBe(true);
    expect(stillFree(changed, slot)).toBe(false);
    expect(schedule(changed).best!.id).not.toBe(slot.id);
    expect(cal.busy.guest).toHaveLength(4); // the original is untouched
  });
});
