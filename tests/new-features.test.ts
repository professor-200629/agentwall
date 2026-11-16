import { describe, expect, it } from 'vitest';
import { fitScale, FOV, fovFromDegrees, fovFromProjection, inView } from '../src/logic/fov.js';
import {
  addCorrection,
  decline,
  emptyLearn,
  parseLearn,
  proposeRule,
  serializeLearn,
  settle,
} from '../src/logic/learn.js';
import {
  allClear,
  dayBefore,
  emptyQueue,
  forToday,
  itemForTask,
  localDay,
  markDone,
  nextItem,
  parseQueue,
  QUEUE,
  queueLine,
  serializeQueue,
} from '../src/logic/queue.js';
import { FOCUS_TASK } from '../src/logic/focus.js';
import { DEMO_TASK } from '../src/logic/plan.js';
import type { Slot } from '../src/logic/scheduler.js';

const BOARD = { width: 1.2, height: 0.94 };
const QUEST3 = fovFromDegrees(110, 96);
const GLASSES = fovFromDegrees(70, 66);
const deg = (r: number) => (r * 180) / Math.PI;

describe('field of view: the board fits what this device can see', () => {
  it('reads the view angles from a projection matrix', () => {
    const f = fovFromProjection(1 / Math.tan((35 * Math.PI) / 180), 1 / Math.tan((33 * Math.PI) / 180));
    expect(deg(f!.h)).toBeCloseTo(70, 5);
    expect(deg(f!.v)).toBeCloseTo(66, 5);
  });

  it('refuses a broken matrix instead of guessing', () => {
    expect(fovFromProjection(0, 1)).toBeNull();
    expect(fovFromProjection(Number.NaN, 1)).toBeNull();
    expect(fovFromProjection(100, 100)).toBeNull(); // about 1 degree: not a headset
  });

  it('a Quest 3 at 1.2 m keeps the full-size board', () => {
    expect(fitScale(BOARD, 1.2, QUEST3, 1)).toBe(1);
  });

  it('the glasses at 1.2 m still fit it; at 1 m they shrink it to stay inside 80% of the view', () => {
    expect(fitScale(BOARD, 1.2, GLASSES, 1)).toBe(1);
    expect(fitScale(BOARD, 1, QUEST3, 1)).toBe(1);
    const s = fitScale(BOARD, 1, GLASSES, 1);
    expect(s).toBeLessThan(1);
    const wide = 2 * Math.atan((BOARD.width * s) / 2 / 1);
    const tall = 2 * Math.atan((BOARD.height * s) / 2 / 1);
    expect(deg(wide)).toBeLessThanOrEqual(70 * FOV.fill + 0.01);
    expect(deg(tall)).toBeLessThanOrEqual(66 * FOV.fill + 0.01);
  });

  it('sitting 0.6 m from the wall: smaller on both, never below the readable minimum', () => {
    const quest = fitScale(BOARD, 0.6, QUEST3, 1);
    const glasses = fitScale(BOARD, 0.6, GLASSES, 1);
    expect(quest).toBeLessThan(1);
    expect(glasses).toBeLessThan(quest);
    expect(fitScale(BOARD, 0.1, GLASSES, 1)).toBe(FOV.minScale);
  });

  it('never makes the board bigger than placement asked for', () => {
    expect(fitScale(BOARD, 3, QUEST3, 1.4)).toBe(1.4);
    expect(fitScale(BOARD, 0, QUEST3, 1.2)).toBe(1.2);
  });

  it('knows when the desk card is out of view', () => {
    const head = { x: 0, y: 1.2, z: 0 };
    const ahead = { x: 0, y: 0, z: -1 };
    const wall = { x: 0, y: 1.2, z: -1.2 };
    const desk = { x: 0, y: 0.75, z: -0.45 }; // 45 degrees below the line of sight
    expect(inView(head, ahead, wall, GLASSES)).toBe(true);
    expect(inView(head, ahead, desk, GLASSES)).toBe(false);
    const down = { x: 0, y: -0.45, z: -0.45 };
    expect(inView(head, down, desk, GLASSES)).toBe(true);
  });
});

describe('morning queue: clear today, count the day', () => {
  const MON = '2026-11-16';
  const TUE = '2026-11-17';
  const THU = '2026-11-19';

  it('starts with every item waiting, focus first and the call last', () => {
    const q = emptyQueue(MON);
    expect(QUEUE.map((i) => i.id)).toEqual(['focus', 'call']);
    expect(nextItem(q)?.id).toBe('focus');
    expect(queueLine(q)).toBe('TODAY 0 of 2 cleared');
  });

  it('knows which task belongs to which item', () => {
    expect(itemForTask(FOCUS_TASK)).toBe('focus');
    expect(itemForTask(DEMO_TASK)).toBe('call');
    expect(itemForTask('something else')).toBeNull();
  });

  it('clearing the last item counts the day, once', () => {
    let r = markDone(emptyQueue(MON), 'focus', MON);
    expect(r.completed).toBe(false);
    expect(queueLine(r.state)).toBe('TODAY 1 of 2 cleared');
    r = markDone(r.state, 'call', MON);
    expect(r.completed).toBe(true);
    expect(allClear(r.state)).toBe(true);
    expect(r.state.streak).toBe(1);
    expect(queueLine(r.state)).toBe('TODAY ✓ all clear · 1 day in a row');
    // A re-plan sends the call again: no second count.
    const again = markDone(r.state, 'call', MON);
    expect(again.completed).toBe(false);
    expect(again.state.streak).toBe(1);
  });

  it('the next day the list is fresh and the count carries on', () => {
    let s = markDone(markDone(emptyQueue(MON), 'focus', MON).state, 'call', MON).state;
    s = forToday(s, TUE);
    expect(s.done).toEqual([]);
    expect(queueLine(s)).toBe('TODAY 0 of 2 cleared · 1 day in a row');
    s = markDone(markDone(s, 'call', TUE).state, 'focus', TUE).state;
    expect(s.streak).toBe(2);
  });

  it('a missed day starts the count again', () => {
    const s = markDone(markDone(emptyQueue(MON), 'focus', MON).state, 'call', MON).state;
    const later = forToday(s, THU);
    expect(later.streak).toBe(0);
    expect(markDone(markDone(later, 'focus', THU).state, 'call', THU).state.streak).toBe(1);
  });

  it('day arithmetic crosses months and years', () => {
    expect(dayBefore('2026-12-01')).toBe('2026-11-30');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
    expect(localDay(new Date(2026, 10, 6))).toBe('2026-11-06');
  });

  it('saves and restores; never trusts what was stored', () => {
    const s = markDone(emptyQueue(MON), 'focus', MON).state;
    expect(parseQueue(serializeQueue(s), MON)).toEqual(s);
    expect(parseQueue(null, MON)).toEqual(emptyQueue(MON));
    expect(parseQueue('not json', MON)).toEqual(emptyQueue(MON));
    expect(parseQueue('{"v":1,"day":"2026-11-16","done":["hack","focus","focus"],"streak":-4,"streakDay":"x"}', MON)).toEqual({
      day: MON,
      done: ['focus'],
      streak: 0,
      streakDay: '',
    });
    // A day from the future (the clock was changed) is not believed.
    expect(parseQueue('{"v":1,"day":"2030-01-01","done":["focus","call"],"streak":900,"streakDay":"2030-01-01"}', MON)).toEqual(
      emptyQueue(MON),
    );
  });
});

describe('learning: the agent offers a rule after two corrections that agree', () => {
  const TUE = '2026-11-17';
  const WED = '2026-11-18';
  const THU = '2026-11-19';
  const slot = (day: string, start: number): Slot => ({
    id: `${day}T${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`,
    day,
    start,
    end: start + 30,
  });
  const twice = (a: [Slot, Slot], b: [Slot, Slot]) => addCorrection(addCorrection(emptyLearn(), ...a), ...b);

  it('says nothing after one correction', () => {
    const s = addCorrection(emptyLearn(), slot(TUE, 780), slot(WED, 780));
    expect(proposeRule(s, {})).toBeNull();
  });

  it('moving the same pick to itself is not a correction', () => {
    expect(addCorrection(emptyLearn(), slot(TUE, 780), slot(TUE, 780)).corrections).toEqual([]);
  });

  it('twice off Tuesday: offers "not Tuesday"', () => {
    const s = twice([slot(TUE, 780), slot(WED, 780)], [slot(TUE, 780), slot(THU, 780)]);
    expect(proposeRule(s, {})).toMatchObject({ key: `not:${TUE}`, rule: { notDays: [TUE] }, label: 'not Tuesday' });
  });

  it('twice later on the same day: offers "only after" the earliest time you took', () => {
    const s = twice([slot(TUE, 780), slot(TUE, 960)], [slot(TUE, 780), slot(TUE, 990)]);
    expect(proposeRule(s, {})).toMatchObject({ key: 'after:960', rule: { after: 960 }, label: 'only after 4:00 PM' });
  });

  it('twice earlier: offers "only before" the end of the latest call you took', () => {
    const s = twice([slot(WED, 1050), slot(WED, 780)], [slot(WED, 1050), slot(WED, 810)]);
    expect(proposeRule(s, {})).toMatchObject({ key: 'before:840', rule: { before: 840 } });
  });

  it('corrections that disagree offer nothing', () => {
    const s = twice([slot(TUE, 780), slot(TUE, 960)], [slot(WED, 1050), slot(WED, 780)]);
    expect(proposeRule(s, {})).toBeNull();
  });

  it('never offers what the rule already says', () => {
    const s = twice([slot(TUE, 780), slot(WED, 780)], [slot(TUE, 780), slot(THU, 780)]);
    expect(proposeRule(s, { notDays: [TUE] })).toBeNull();
    const later = twice([slot(TUE, 780), slot(TUE, 960)], [slot(TUE, 780), slot(TUE, 990)]);
    expect(proposeRule(later, { after: 960 })).toBeNull();
  });

  it('a declined offer is not made again; a different one still can be', () => {
    // Off Tuesday AND later, both times: two readings of the same corrections.
    const s = twice([slot(TUE, 780), slot(WED, 960)], [slot(TUE, 780), slot(THU, 990)]);
    const first = proposeRule(s, {});
    expect(first?.key).toBe(`not:${TUE}`);
    const said = decline(s, first!.key);
    expect(proposeRule(said, {})?.key).toBe('after:960');
    expect(proposeRule(decline(said, 'after:960'), {})).toBeNull();
  });

  it('after an answer the count starts again', () => {
    const s = twice([slot(TUE, 780), slot(WED, 780)], [slot(TUE, 780), slot(THU, 780)]);
    expect(proposeRule(settle(s), {})).toBeNull();
  });

  it('saves and restores; drops anything malformed', () => {
    const s = decline(twice([slot(TUE, 780), slot(WED, 780)], [slot(TUE, 780), slot(THU, 780)]), `not:${TUE}`);
    expect(parseLearn(serializeLearn(s))).toEqual(s);
    expect(parseLearn(null)).toEqual(emptyLearn());
    expect(parseLearn('{')).toEqual(emptyLearn());
    expect(
      parseLearn('{"v":1,"corrections":[{"fromDay":"x"},{"fromDay":"2026-11-17","toDay":"2026-11-18","fromStart":780,"toStart":99999}],"declined":["<script>","after:960"]}'),
    ).toEqual({ corrections: [], declined: ['after:960'] });
  });
});
