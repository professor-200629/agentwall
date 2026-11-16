// Conflict review, live: does the real model turn a natural sentence (one the rule
// parser cannot read) into a limit that changes the two candidates on the wall?
//   npx vitest run --config vitest.live.config.ts tests/live/review.live.ts
// Calls Groq through the Worker code (worker/.dev.vars holds the key). A few calls only.
// PROBE="sentence one|sentence two" prints what the model makes of other sentences (no pass/fail).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import calendarJson from '../../src/data/sample-calendar.json';
import { understandRule, type FetchLike } from '../../src/logic/agent.js';
import { exampleBlock, withExample } from '../../src/logic/example-change.js';
import { makePlan } from '../../src/logic/plan.js';
import { parseRequest } from '../../src/logic/request.js';
import { candidates, overlapsOf } from '../../src/logic/review.js';
import type { CalendarData } from '../../src/logic/scheduler.js';
import worker from '../../worker/src/index.js';

const A = calendarJson as CalendarData;
const key = /GROQ_API_KEY=(\S+)/.exec(readFileSync('worker/.dev.vars', 'utf8'))?.[1] ?? '';
const SITE = 'https://professor-200629.github.io';
const MODEL = process.env.MODEL ?? 'qwen/qwen3.8-27b';
const old = makePlan(A).slot!; // Tue 1:00 PM
const B = withExample(A, [exampleBlock(A, old)]);

/** The app's own request, sent through the Worker code to the real model. */
const viaWorker: FetchLike = (url, init) =>
  worker.fetch(new Request(url, { ...init, headers: { ...(init.headers as Record<string, string>), origin: SITE } }), {
    GROQ_API_KEY: key,
    MODEL,
  });

type Want = 'changes' | 'none' | 'print';
// Sentences away from the preset wording; none has a word the rules can read.
const SAID: Array<{ say: string; want: Want }> = process.env.PROBE
  ? process.env.PROBE.split('|').map((say) => ({ say: say.trim(), want: 'print' as const }))
  : [
      // Understood, and the two times on the wall change.
      { say: "could we push it past three o'clock", want: 'changes' },
      // Printed only: the model reads this one differently from run to run (after noon, or nothing).
      { say: "I'd rather not do it before lunch", want: 'print' },
      // Nothing to act on: the board asks again and the pinchable times stay.
      { say: 'what is the weather like', want: 'none' },
    ];

describe(`conflict review with the live model (${MODEL})`, () => {
  it.each(SAID)('"$say"', async ({ say, want }) => {
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.GAP_MS ?? 4000)));
    const rules = parseRequest(say, B).intent;
    const before = candidates(B, 'call', old);
    const t0 = performance.now();
    const got = await understandRule(B, say, {}, { url: 'https://w.example', fetch: viaWorker, timeoutMs: 8000 });
    const ms = Math.round(performance.now() - t0);
    const after = candidates(B, 'call', old, got.constraint);
    const changed = after.map((c) => c.slot.id).join() !== before.map((c) => c.slot.id).join();
    console.log(
      `${ms} ms | rules read it as "${rules}" | by ${got.by}${got.note ? ` (${got.note})` : ''} | limit ${JSON.stringify(got.constraint)} | ${before.map((c) => c.label).join(', ')} -> ${after.map((c) => c.label).join(', ') || 'none'}`,
    );
    // Whatever the model said, nothing busy is ever offered: the scheduler decides.
    expect(after.every((c) => overlapsOf(B, c.slot).length === 0)).toBe(true);
    if (want === 'print') return;
    expect(rules).toBe('unknown'); // the rules really cannot read it
    if (want === 'none') {
      expect(got.by).toBe('none');
      return;
    }
    expect(got.by).toBe('ai');
    expect(changed).toBe(true);
  });
});
