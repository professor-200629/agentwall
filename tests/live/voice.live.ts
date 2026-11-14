// Real Whisper (Groq) through the Worker's /transcribe, then the rule parser.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import calendarJson from '../../src/data/sample-calendar.json';
import { parseRequest } from '../../src/logic/request.js';
import type { CalendarData } from '../../src/logic/scheduler.js';
import worker from '../../worker/src/index.js';

const key = /GROQ_API_KEY=(\S+)/.exec(readFileSync('worker/.dev.vars', 'utf8'))?.[1] ?? '';
const WAV = process.env.WAV ?? '';

it.skipIf(!WAV)('transcribes speech and the agent understands it', async () => {
  const form = new FormData();
  form.append('audio', new File([readFileSync(WAV)], 'speech.wav', { type: 'audio/wav' }));
  const req = new Request('https://w.example/transcribe', {
    method: 'POST',
    headers: { origin: 'https://professor-200629.github.io' },
    body: form,
  });
  const t0 = performance.now();
  const res = await worker.fetch(req, { GROQ_API_KEY: key });
  const ms = Math.round(performance.now() - t0);
  const data = (await res.json()) as { text?: string; error?: string };
  const parsed = parseRequest(data.text ?? '', calendarJson as CalendarData);
  console.log(`VOICE ${res.status} ${ms} ms | heard: "${data.text ?? data.error}" | rules read: ${JSON.stringify(parsed)}`);
  expect(res.status).toBe(200);
});
