/**
 * Agent Wall Worker: a small proxy so the Groq API key never ships in the app.
 *
 *   GET  /health      -> { ok, model }
 *   POST /plan        -> Groq chat (JSON mode) -> the model's JSON answer
 *   POST /transcribe  -> multipart "audio" file -> Groq Whisper -> { text }
 *
 * Only the Agent Wall site (ALLOWED_ORIGINS) may call it from a browser.
 * The app checks every answer itself and falls back to rules, so this Worker
 * is allowed to fail.
 */
import {
  buildMessages,
  corsFor,
  DEFAULT_MODEL,
  DEFAULT_ORIGINS,
  GROQ_BASE,
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

  const upstream = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.GROQ_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env.MODEL || DEFAULT_MODEL,
      messages: buildMessages(payload),
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 450,
    }),
  });
  if (!upstream.ok) return json({ error: `groq ${upstream.status}` }, 502, cors);
  const data = (await upstream.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const answer = parseModelJson(data.choices?.[0]?.message?.content ?? '');
  if (!answer) return json({ error: 'model returned no JSON' }, 502, cors);
  return json(answer, 200, cors);
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
    if (!env.GROQ_API_KEY) return json({ error: 'GROQ_API_KEY not set' }, 500, cors);
    if (!limiter.allow(req.headers.get('cf-connecting-ip') ?? 'unknown')) {
      return json({ error: 'slow down' }, 429, cors);
    }

    try {
      if (url.pathname === '/plan') return await plan(req, env, cors);
      if (url.pathname === '/transcribe') return await transcribe(req, env, cors);
    } catch {
      return json({ error: 'upstream failed' }, 502, cors);
    }
    return json({ error: 'not found' }, 404, cors);
  },
};
