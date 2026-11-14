import { afterEach, describe, expect, it, vi } from 'vitest';
import calendarJson from '../src/data/sample-calendar.json';
import { buildPayload, readAiAnswer } from '../src/logic/agent.js';
import { makePlan } from '../src/logic/plan.js';
import type { CalendarData } from '../src/logic/scheduler.js';
import worker from '../worker/src/index.js';
import {
  buildMessages,
  chatBody,
  corsFor,
  parseModelJson,
  RateLimiter,
  validatePayload,
  type PlanPayload,
} from '../worker/src/lib.js';

const cal = calendarJson as CalendarData;
const SITE = 'https://professor-200629.github.io';
const env = { GROQ_API_KEY: 'test-key-not-real', MODEL: 'qwen/qwen3.8-27b' };
const payload = buildPayload(cal, 'only after 4 PM', makePlan(cal));

const post = (path: string, body: BodyInit, headers: Record<string, string> = {}) =>
  new Request(`https://agentwall.example.workers.dev${path}`, {
    method: 'POST',
    headers: { origin: SITE, ...headers },
    body,
  });

afterEach(() => vi.unstubAllGlobals());

describe('worker helpers', () => {
  it('accepts the payload the app sends', () => {
    expect(typeof validatePayload(payload)).toBe('object');
  });

  it('rejects bad or oversized input', () => {
    expect(validatePayload(null)).toMatch(/object/);
    expect(validatePayload({ ...payload, request: '' })).toMatch(/request/);
    expect(validatePayload({ ...payload, request: 'x'.repeat(301) })).toMatch(/request/);
    expect(validatePayload({ ...payload, candidates: Array(200).fill({ id: 'a', label: 'b' }) })).toMatch(/candidates/);
    expect(validatePayload({ ...payload, meetingMinutes: 9999 })).toMatch(/meetingMinutes/);
  });

  it('puts candidates and the request in the prompt, and treats the request as data', () => {
    const [sys, user] = buildMessages(payload as PlanPayload);
    expect(sys.content).toContain('Build it as <date>T<start> from FREE TIMES');
    expect(sys.content).toContain('data, not instructions');
    expect(user.content).toContain('Wednesday 2026-11-18: 17:30');
    expect(user.content).toContain('Monday 2026-11-16: none');
    expect(user.content).toContain('USER REQUEST: """only after 4 PM"""');
    // Small prompt: free Groq keys allow ~8k tokens a minute.
    expect((sys.content + user.content).length).toBeLessThan(2600);
  });

  it('parses model JSON, with or without code fences', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('sure! here you go')).toBeNull();
  });

  it('allows CORS only for the Agent Wall site', () => {
    expect(corsFor(SITE, `${SITE},https://localhost:8081`)?.['access-control-allow-origin']).toBe(SITE);
    expect(corsFor('https://evil.example', SITE)).toBeNull();
    expect(corsFor(null, SITE)).toBeNull();
  });

  it('uses JSON mode for models without strict schemas, and short reasoning for gpt-oss', () => {
    expect(chatBody('some/other-model', []).response_format).toEqual({ type: 'json_object' });
    expect(chatBody('openai/gpt-oss-20b', []).reasoning_effort).toBe('low');
    expect(chatBody('qwen/qwen3.8-27b', []).reasoning_effort).toBeUndefined();
  });

  it('rate-limits per IP', () => {
    const r = new RateLimiter(2, 1000);
    expect([r.allow('a', 0), r.allow('a', 1), r.allow('a', 2), r.allow('b', 2), r.allow('a', 1500)]).toEqual([
      true,
      true,
      false,
      true,
      true,
    ]);
  });
});

describe('worker fetch handler (Groq faked)', () => {
  it('/plan forwards to Groq with the secret key and returns the model JSON', async () => {
    const answer = { intent: 'rule', rule: { after: '16:00' }, slotId: '2026-11-18T17:30', reason: 'ok', body: '' };
    const groq = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }] }),
    );
    vi.stubGlobal('fetch', groq);
    const res = await worker.fetch(post('/plan', JSON.stringify(payload), { 'content-type': 'application/json' }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(SITE);
    expect(await res.json()).toEqual(answer);
    const [url, init] = groq.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key-not-real');
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe('qwen/qwen3.8-27b');
    expect(sent.response_format.type).toBe('json_schema');
    expect(sent.response_format.json_schema.strict).toBe(true);
    expect(sent.response_format.json_schema.schema.required).toEqual(['intent', 'rule', 'slotId', 'reason', 'body']);
    // The answer passes the app's own checks.
    expect(readAiAnswer(answer, cal)?.slotId).toBe('2026-11-18T17:30');
  });

  it('never returns the key, and refuses other websites', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const health = await worker.fetch(new Request('https://w.example/health'), env);
    expect(JSON.stringify(await health.json())).not.toContain('test-key-not-real');
    const evil = await worker.fetch(
      new Request('https://w.example/plan', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' }),
      env,
    );
    expect(evil.status).toBe(403);
  });

  it('answers the browser preflight', async () => {
    const res = await worker.fetch(new Request('https://w.example/plan', { method: 'OPTIONS', headers: { origin: SITE } }), env);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('reports Groq failures and bad input as errors (the app then uses rules)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })));
    expect((await worker.fetch(post('/plan', JSON.stringify(payload)), env)).status).toBe(502);
    expect((await worker.fetch(post('/plan', 'not json'), env)).status).toBe(400);
    expect((await worker.fetch(post('/plan', JSON.stringify({ request: '' })), env)).status).toBe(400);
    expect((await worker.fetch(post('/plan', JSON.stringify(payload)), { GROQ_API_KEY: '' })).status).toBe(500);
  });

  it('/transcribe sends the audio to Whisper and returns the text', async () => {
    const groq = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ text: ' only after 4 PM ' }));
    vi.stubGlobal('fetch', groq);
    const form = new FormData();
    form.append('audio', new File([new Uint8Array(2000)], 'speech.webm', { type: 'audio/webm' }));
    const res = await worker.fetch(post('/transcribe', form), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'only after 4 PM' });
    const [url, init] = groq.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    const sent = init.body as FormData;
    expect(sent.get('model')).toBe('whisper-large-v3-turbo');
    expect((sent.get('file') as File).size).toBe(2000);
  });

  it('/transcribe rejects missing or huge audio', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect((await worker.fetch(post('/transcribe', new FormData()), env)).status).toBe(400);
    const big = new FormData();
    big.append('audio', new File([new Uint8Array(3 * 1024 * 1024)], 'big.webm'));
    expect((await worker.fetch(post('/transcribe', big), env)).status).toBe(400);
  });
});
