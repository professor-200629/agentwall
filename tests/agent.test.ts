import { describe, expect, it } from 'vitest';
import calendarJson from '../src/data/sample-calendar.json';
import {
  bodyMatchesSlot,
  buildPayload,
  planFromAi,
  planWithRules,
  readAiAnswer,
  runAgent,
  type AiAnswer,
  type FetchLike,
} from '../src/logic/agent.js';
import { makePlan } from '../src/logic/plan.js';
import { mergeConstraint, parseRequest, ruleText } from '../src/logic/request.js';
import type { CalendarData } from '../src/logic/scheduler.js';

const cal = calendarJson as CalendarData;
const at = (h: number, m = 0) => h * 60 + m;
const WED = '2026-11-18';
const THU = '2026-11-19';

describe('parseRequest (rules)', () => {
  const p = (t: string) => parseRequest(t, cal);

  it('recognises the task', () => {
    expect(p('Find a time for my app tester call and draft the invite')).toEqual({ intent: 'plan', rule: {} });
  });

  it('understands "after" times in several spellings', () => {
    for (const t of ['only after 4 PM', 'after 4', 'after 16:00', 'After 4pm please', 'not before 4 p.m.']) {
      expect(p(t), t).toEqual({ intent: 'rule', rule: { after: at(16) } });
    }
    expect(p('after 4:30 p.m.').rule.after).toBe(at(16, 30));
    expect(p('after 10am').rule.after).toBe(at(10));
    expect(p('afternoon is better').rule.after).toBe(at(12));
    expect(p('evenings').rule.after).toBe(at(16));
  });

  it('understands "before" and mornings', () => {
    expect(p('before 3').rule.before).toBe(at(15));
    expect(p('mornings only').rule.before).toBe(at(12));
    expect(p('by noon').rule.before).toBe(at(12));
  });

  it('understands days', () => {
    expect(p('not Wednesday').rule).toEqual({ notDays: [WED] });
    expect(p("can't do wednesdays, skip wednesday").rule.notDays).toEqual([WED]);
    expect(p('Thursday only').rule).toEqual({ day: THU });
    expect(p('tomorrow').rule).toEqual({ day: '2026-11-17' });
  });

  it('combines a task and a rule in one sentence', () => {
    expect(p('find a time after 4 pm on Thursday')).toEqual({ intent: 'plan', rule: { after: at(16), day: THU } });
  });

  it('clears the rule, and admits when it does not understand', () => {
    expect(p('any time is fine').intent).toBe('clear');
    expect(p('clear the rule').intent).toBe('clear');
    expect(p('hello there').intent).toBe('unknown');
  });
});

describe('mergeConstraint and ruleText', () => {
  it('adds new parts to the current rule', () => {
    expect(mergeConstraint({ after: at(16) }, { notDays: [WED] })).toEqual({ after: at(16), notDays: [WED] });
  });

  it('a newer "not Thursday" removes "Thursday only"', () => {
    expect(mergeConstraint({ day: THU }, { notDays: [THU] })).toEqual({ notDays: [THU] });
  });

  it('a newer "Thursday only" lifts "not Thursday"', () => {
    expect(mergeConstraint({ notDays: [THU] }, { day: THU })).toEqual({ day: THU });
  });

  it('an impossible time window keeps the newer half', () => {
    expect(mergeConstraint({ after: at(17) }, { before: at(16) })).toEqual({ before: at(16) });
  });

  it('writes a short rule line', () => {
    expect(ruleText({ after: at(16) })).toBe('only after 4 PM');
    expect(ruleText({ after: at(16), notDays: [WED] })).toBe('only after 4 PM, not on Wednesday');
    expect(ruleText({})).toBe('');
  });
});

describe('planWithRules', () => {
  const start = makePlan(cal);

  it('"only after 4 PM" moves the slot to Wed 5:30 PM', () => {
    const r = planWithRules(cal, 'only after 4 PM', start);
    expect(r.plan!.slot!.id).toBe(`${WED}T17:30`);
    expect(r.plan!.constraintText).toBe('only after 4 PM');
    expect(r.plan!.by).toBe('rules');
  });

  it('rules build on each other, and "any time" clears them', () => {
    const a = planWithRules(cal, 'only after 4 PM', start).plan!;
    const b = planWithRules(cal, 'not Wednesday', a).plan!;
    expect(b.slot!.id).toBe(`${THU}T16:00`);
    expect(b.constraintText).toBe('only after 4 PM, not on Wednesday');
    expect(planWithRules(cal, 'any time', b).plan!.slot!.id).toBe('2026-11-17T13:00');
  });

  it('does nothing for a sentence it does not understand', () => {
    expect(planWithRules(cal, 'what is the weather', start).plan).toBeNull();
  });
});

describe('checking the AI answer', () => {
  const start = makePlan(cal);
  const good: AiAnswer = {
    intent: 'rule',
    rule: { after: '16:00', before: null, day: null, notDays: [] },
    slotId: `${THU}T16:00`,
    reason: 'Thursday 4 PM leaves Sam time after class.',
    body: 'Hi Sam,\n\nAre you free on Thursday 19 Nov at 4:00 PM IST for a 30-minute call about your app test?\n\nThanks,\nBalu',
  };

  it('uses a valid AI choice and email, even when it is not the earliest slot', () => {
    const r = planFromAi(cal, good, start);
    expect(r.plan!.slot!.id).toBe(`${THU}T16:00`);
    expect(r.plan!.invite!.source).toBe('ai');
    expect(r.plan!.invite!.body).toBe(good.body);
    expect(r.plan!.invite!.subject).toBe('App test call: Thu 19 Nov, 4:00 – 4:30 PM IST');
    expect(r.plan!.reason).toBe(good.reason);
    expect(r.plan!.by).toBe('ai');
    expect(r.note).toBe('');
  });

  it('overrides an AI slot that breaks its own rule', () => {
    const r = planFromAi(cal, { ...good, slotId: '2026-11-17T13:00' }, start);
    expect(r.plan!.slot!.id).toBe(`${WED}T17:30`);
    expect(r.plan!.invite!.source).toBe('rules');
    expect(r.note).toContain('did not fit');
  });

  it('overrides an invented slot id', () => {
    expect(planFromAi(cal, { ...good, slotId: '2026-11-19T03:00' }, start).plan!.slot!.id).toBe(`${WED}T17:30`);
  });

  it('replaces an email that names the wrong day or time', () => {
    const wrongDay = planFromAi(cal, { ...good, body: good.body.replace('Thursday 19 Nov', 'Friday 20 Nov') }, start);
    expect(wrongDay.plan!.invite!.source).toBe('rules');
    expect(wrongDay.note).toContain('rules wrote the email');
    const wrongTime = planFromAi(cal, { ...good, body: good.body.replace('4:00 PM', '5:00 PM') }, start);
    expect(wrongTime.plan!.invite!.source).toBe('rules');
  });

  it('accepts the time written as a range, as the candidate labels show it', () => {
    const slot = planFromAi(cal, good, start).plan!.slot!; // Thu 4:00 PM
    expect(bodyMatchesSlot('Hi Sam, Thursday 19 Nov, 4:00 – 4:30 PM IST? Balu', slot, cal)).toBe(true);
    expect(bodyMatchesSlot('Hi Sam, Thursday at 4 pm? Balu', slot, cal)).toBe(true);
    expect(bodyMatchesSlot('Hi Sam, Thursday 4pm? Balu', slot, cal)).toBe(true);
    expect(bodyMatchesSlot('Hi Sam, Thursday 14:00 – 4:30 PM? Balu', slot, cal)).toBe(false);
    expect(bodyMatchesSlot('Hi Sam, Thursday 4:00 AM? Balu', slot, cal)).toBe(false);
    // 24-hour form, as a real model wrote it on 14 Nov.
    expect(bodyMatchesSlot('Hi Sam, on Thursday, 19 November, from 16:00 to 16:30 IST. Best, Balu', slot, cal)).toBe(true);
    expect(bodyMatchesSlot('Hi Sam, on Thursday from 116:00? Balu', slot, cal)).toBe(false);
    expect(bodyMatchesSlot('Hi Sam, on Thursday from 16:005? Balu', slot, cal)).toBe(false);
  });

  it('rejects emails with links or that are far too long', () => {
    const slot = planFromAi(cal, good, start).plan!.slot!;
    expect(bodyMatchesSlot(`${good.body}\nJoin: https://evil.example`, slot, cal)).toBe(false);
    expect(bodyMatchesSlot(`${good.body}${' x'.repeat(600)}`, slot, cal)).toBe(false);
    expect(bodyMatchesSlot(good.body, slot, cal)).toBe(true);
  });

  it('reads only well-formed answers and drops made-up dates and times', () => {
    expect(readAiAnswer('nope', cal)).toBeNull();
    expect(readAiAnswer({ intent: 'dance' }, cal)).toBeNull();
    const a = readAiAnswer(
      { intent: 'rule', rule: { after: '25:99', day: '2030-01-01', notDays: [WED, 'soon'] }, slotId: 7 },
      cal,
    )!;
    expect(a.rule).toEqual({ after: null, before: null, day: null, notDays: [WED] });
    expect(a.slotId).toBeNull();
  });

  it('sends only free times that already fit the current rule, except for "any time"', () => {
    const after4 = planWithRules(cal, 'only after 4 PM', makePlan(cal)).plan!;
    const ids = buildPayload(cal, 'not Wednesday', after4).candidates.map((c) => c.id);
    expect(ids.every((id) => Number(id.slice(11, 13)) >= 16)).toBe(true);
    // "not Wednesday" is understood by the rules, so Wednesday is already gone.
    expect(ids.some((id) => id.startsWith(WED))).toBe(false);
    expect(ids).toContain(`${THU}T16:00`);
    const all = buildPayload(cal, 'any time', after4).candidates.map((c) => c.id);
    expect(all).toContain('2026-11-17T13:00');
  });

  it('sends the AI only free slots and the facts it needs', () => {
    const p = buildPayload(cal, 'only after 4 PM', start);
    expect(p.candidates.length).toBeGreaterThan(5);
    expect(p.candidates.map((c) => c.id)).toContain(`${WED}T17:30`);
    expect(p.candidates.map((c) => c.id)).not.toContain('2026-11-17T09:00'); // busy
    expect(p.today).toBe('Monday 16 Nov, 9:00 AM');
    expect(JSON.stringify(p)).not.toContain('@'); // no email addresses leave the device
  });
});

describe('chips always obey their rule (code review 14 Nov)', () => {
  const start = makePlan(cal);
  const base: AiAnswer = {
    intent: 'rule',
    rule: { after: null, before: null, day: null, notDays: [] },
    slotId: null,
    reason: '',
    body: '',
  };

  it('an AI that reads "4 PM" as 04:00 cannot change the chip rule', () => {
    const r = planFromAi(cal, { ...base, rule: { ...base.rule, after: '04:00' } }, start, 'only after 4 PM');
    expect(r.plan!.constraint).toEqual({ after: at(16) });
    expect(r.plan!.constraintText).toBe('only after 4 PM');
    expect(r.plan!.slot!.id).toBe(`${WED}T17:30`);
  });

  it('an AI that says "unknown" cannot veto a chip', () => {
    const r = planFromAi(cal, { ...base, intent: 'unknown' }, start, 'not Wednesday');
    expect(r.plan).not.toBeNull();
    expect(r.plan!.constraint).toEqual({ notDays: [WED] });
  });

  it('"any time" always clears the rule, whatever the AI says', () => {
    const after4 = planWithRules(cal, 'only after 4 PM', start).plan!;
    const r = planFromAi(cal, { ...base, intent: 'rule', rule: { ...base.rule, after: '16:00' } }, after4, 'any time');
    expect(r.plan!.constraint).toEqual({});
    expect(r.plan!.slot!.id).toBe('2026-11-17T13:00');
  });

  it('for a known request the AI only sees times inside the final rule', () => {
    const p = buildPayload(cal, 'only after 4 PM', start);
    expect(p.candidates.every((c) => Number(c.id.slice(11, 13)) >= 16)).toBe(true);
    expect(p.currentRule).toBe('only after 4 PM');
  });

  it('a sentence the rules cannot read still uses the AI rule', () => {
    const r = planFromAi(
      cal,
      { ...base, rule: { ...base.rule, day: THU }, slotId: `${THU}T12:30` },
      start,
      'whenever Sam is out of class on the 19th',
    );
    expect(r.plan!.constraint).toEqual({ day: THU });
    expect(r.plan!.slot!.id).toBe(`${THU}T12:30`);
  });

  it('a busy AI (429) shows as "AI busy", not an error code', async () => {
    const busy: FetchLike = async () => new Response('{}', { status: 429 });
    const r = await runAgent(cal, 'only after 4 PM', start, { url: 'https://w.example', fetch: busy });
    expect(r.note).toContain('AI busy');
  });
});

describe('runAgent: AI with a 3-second fallback', () => {
  const start = makePlan(cal);
  const ok = (body: unknown, status = 200): FetchLike => async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const answer = {
    intent: 'rule',
    rule: { after: '16:00', before: null, day: null, notDays: [] },
    slotId: `${WED}T17:30`,
    reason: 'Earliest after 4 PM.',
    body: 'Hi Sam, could we talk on Wednesday at 5:30 PM IST? Thanks, Balu',
  };

  it('uses the AI when it answers in time', async () => {
    const r = await runAgent(cal, 'only after 4 PM', start, { url: 'https://w.example', fetch: ok(answer) });
    expect(r.by).toBe('ai');
    expect(r.plan!.invite!.source).toBe('ai');
  });

  it('falls back to rules when the AI is too slow', async () => {
    const slow: FetchLike = (_u, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const t0 = Date.now();
    const r = await runAgent(cal, 'only after 4 PM', start, { url: 'https://w.example', fetch: slow, timeoutMs: 50 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.by).toBe('rules');
    expect(r.note).toContain('too slow');
    expect(r.plan!.slot!.id).toBe(`${WED}T17:30`);
  });

  it('falls back when offline, on errors, on junk, and when not set up', async () => {
    const offline: FetchLike = async () => {
      throw new TypeError('Failed to fetch');
    };
    const url = 'https://w.example';
    expect((await runAgent(cal, 'only after 4 PM', start, { url, fetch: offline })).note).toContain('offline');
    expect((await runAgent(cal, 'only after 4 PM', start, { url, fetch: ok({}, 500) })).note).toContain('500');
    expect((await runAgent(cal, 'only after 4 PM', start, { url, fetch: ok({ hi: 1 }) })).note).toContain('unreadable');
    const none = await runAgent(cal, 'only after 4 PM', start, { url: '' });
    expect(none.by).toBe('rules');
    expect(none.plan!.slot!.id).toBe(`${WED}T17:30`);
  });
});
