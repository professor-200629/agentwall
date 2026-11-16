/**
 * Agent Wall Worker: a small proxy so the Groq API key never ships in the app.
 *
 *   GET  /health      -> { ok, model }
 *   POST /plan        -> Groq chat (JSON mode) -> the model's JSON answer
 *   POST /transcribe  -> multipart "audio" file -> Groq Whisper -> { text }
 *   POST /ics         -> { url } of a private iCal link on a known calendar host -> its text
 *                        (calendar hosts block browsers from reading them directly).
 *                        The link and the calendar are not logged and not stored.
 *
 * Only the Agent Wall site (ALLOWED_ORIGINS) may call it from a browser.
 * The app checks every answer itself and falls back to rules, so this Worker
 * is allowed to fail.
 */
import {
  buildMessages,
  chatBody,
  corsFor,
  DEFAULT_MODEL,
  DEFAULT_ORIGINS,
  GROQ_BASE,
  icsUrlAllowed,
  MAX_ICS_BYTES,
  MAX_AUDIO_BYTES,
  parseModelJson,
  RateLimiter,
  validatePayload,
  WHISPER_MODEL,
} from './lib.js';

interface Env {
  GROQ_API_KEY: string;
  MODEL?: string;
  ALLOWED_ORIGINS?: string;
}

const limiter = new RateLimiter(20, 60_000);

function json(body: unknown, status: number, cors: Record<string, string> | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...(cors ?? {}) },
  });
}

async function plan(req: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400, cors);
  }
  const payload = validatePayload(raw);
  if (typeof payload === 'string') return json({ error: payload }, 400, cors);

  const model = env.MODEL || DEFAULT_MODEL;
  const messages = buildMessages(payload);
  const call = (body: Record<string, unknown>) =>
    fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.GROQ_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const strictBody = chatBody(model, messages);
  let upstream = await call(strictBody);
  // Strict schema mode occasionally fails validation on Groq (400 json_validate_failed).
  // Retry once in plain JSON mode; the app checks the answer either way.
  if (upstream.status === 400 && (strictBody.response_format as { type: string }).type === 'json_schema') {
    upstream = await call({ ...strictBody, response_format: { type: 'json_object' } });
  }
  if (!upstream.ok) {
    // Pass on Groq's error code only (e.g. json_validate_failed, rate_limit_exceeded), never its message.
    let code = '';
    try {
      code = ((await upstream.json()) as { error?: { code?: string } }).error?.code ?? '';
    } catch {
      // not JSON
    }
    return json({ error: `groq ${upstream.status}${code ? ` ${code.replace(/[^a-z_]/gi, '').slice(0, 40)}` : ''}` }, 502, cors);
  }
  const data = (await upstream.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const answer = parseModelJson(data.choices?.[0]?.message?.content ?? '');
  if (!answer) return json({ error: 'model returned no JSON' }, 502, cors);
  return json(answer, 200, cors);
}

async function ics(req: Request, cors: Record<string, string>): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400, cors);
  }
  const url = icsUrlAllowed((raw as { url?: unknown } | null)?.url);
  if (!url) return json({ error: 'only https links to Google, Outlook or iCloud calendars' }, 400, cors);
  // Redirects are followed by hand so every hop stays on an allowed calendar host.
  let res: Response | null = null;
  let next: URL | null = url;
  for (let hop = 0; hop < 4 && next; hop++) {
    res = await fetch(next.toString(), { redirect: 'manual', headers: { accept: 'text/calendar, text/plain;q=0.8' } });
    const to = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!to) break;
    next = icsUrlAllowed(new URL(to, next).toString());
    if (!next) return json({ error: 'the link redirects somewhere else' }, 400, cors);
    res = null;
  }
  if (!res) return json({ error: 'too many redirects' }, 502, cors);
  if (res.status === 404 || res.status === 403 || res.status === 401) return json({ error: 'calendar not found' }, 404, cors);
  if (!res.ok) return json({ error: `calendar host ${res.status}` }, 502, cors);
  if (Number(res.headers.get('content-length') ?? '0') > MAX_ICS_BYTES) return json({ error: 'calendar too large' }, 413, cors);
  const text = await res.text();
  if (text.length > MAX_ICS_BYTES) return json({ error: 'calendar too large' }, 413, cors);
  if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 2000))) return json({ error: 'not a calendar' }, 400, cors);
  return new Response(text, { status: 200, headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store', ...cors } });
}

async function transcribe(req: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > MAX_AUDIO_BYTES + 10_000) return json({ error: 'audio too large' }, 413, cors);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: 'expected multipart form data' }, 400, cors);
  }
  const audio = form.get('audio');
  if (!(audio instanceof File) || audio.size === 0 || audio.size > MAX_AUDIO_BYTES) {
    return json({ error: 'audio file missing or too large' }, 400, cors);
  }
  const out = new FormData();
  out.append('file', audio, audio.name || 'speech.webm');
  out.append('model', WHISPER_MODEL);
  out.append('language', 'en');
  out.append('response_format', 'json');
  const upstream = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: out,
  });
  if (!upstream.ok) return json({ error: `groq ${upstream.status}` }, 502, cors);
  const data = (await upstream.json()) as { text?: string };
  return json({ text: (data.text ?? '').trim().slice(0, 300) }, 200, cors);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsFor(req.headers.get('origin'), env.ALLOWED_ORIGINS || DEFAULT_ORIGINS);

    if (req.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, model: env.MODEL || DEFAULT_MODEL, key: Boolean(env.GROQ_API_KEY) }, 200, cors);
    }
    if (!cors) return json({ error: 'origin not allowed' }, 403, null);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'not found' }, 404, cors);
    if (!limiter.allow(req.headers.get('cf-connecting-ip') ?? 'unknown')) {
      return json({ error: 'slow down' }, 429, cors);
    }
    if (url.pathname === '/ics') {
      try {
        return await ics(req, cors);
      } catch {
        return json({ error: 'calendar host failed' }, 502, cors);
      }
    }
    if (!env.GROQ_API_KEY) return json({ error: 'GROQ_API_KEY not set' }, 500, cors);

    try {
      if (url.pathname === '/plan') return await plan(req, env, cors);
      if (url.pathname === '/transcribe') return await transcribe(req, env, cors);
    } catch {
      return json({ error: 'upstream failed' }, 502, cors);
    }
    return json({ error: 'not found' }, 404, cors);
  },
};
