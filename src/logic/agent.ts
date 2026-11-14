/**
 * The agent's one narrow AI job: turn what the user said ("only after 4 PM")
 * plus the sample calendar into a slot choice and an email body.
 *
 *   user text ──▶ AI (Groq, via our Worker) ──▶ answer ──▶ checkAiAnswer ──▶ plan
 *                    │ slow (>3 s), offline, error,          │ wrong slot / bad email
 *                    ▼ or nonsense                           ▼
 *                 rules (parseRequest + scheduler)        rules fill in that part
 *
 * The AI may only choose from free slots the scheduler computed, and every
 * part of its answer is checked. The demo never depends on the network.
 *
 * Plain TypeScript; the network call is injected so tests can fake it.
 */
import { makePlan, type Plan } from './plan.js';
import { mergeConstraint, parseRequest, ruleText, type Intent } from './request.js';
import {
  clock,
  dayLabel,
  freeSlots,
  hm,
  slotLabel,
  type CalendarData,
  type Constraint,
  type Slot,
} from './scheduler.js';

export const AI_TIMEOUT_MS = 3000;
const MAX_BODY = 900;
const MAX_REASON = 160;

/** What the client sends to the Worker's /plan endpoint. */
export interface AgentPayload {
  request: string;
  today: string;
  timezone: string;
  owner: string;
  guest: string;
  meetingMinutes: number;
  currentRule: string;
  days: Array<{ date: string; weekday: string }>;
  /** Free slots that fit the current rule (all of them for "any time"); the AI must pick one. */
  candidates: Array<{ id: string; label: string }>;
}

/** What the AI must answer (JSON). Times "HH:MM", dates "YYYY-MM-DD". */
export interface AiAnswer {
  intent: Intent;
  rule: { after: string | null; before: string | null; day: string | null; notDays: string[] };
  slotId: string | null;
  reason: string;
  body: string;
}

export interface AgentResult {
  /** null when the request was not understood (nothing changes). */
  plan: Plan | null;
  by: 'ai' | 'rules';
  /** Short explanation shown when the rules stepped in. */
  note: string;
}

export function buildPayload(cal: CalendarData, request: string, current: Plan | null): AgentPayload {
  return {
    request: request.slice(0, 300),
    today: `${dayLabel(cal.now.split('T')[0]).long}, ${clock(hm(cal.now.split('T')[1]))}`,
    timezone: cal.timezone,
    owner: cal.owner.name,
    guest: `${cal.guest.name} (${cal.guest.role ?? 'guest'})`,
    meetingMinutes: cal.meeting.minutes,
    currentRule: current?.constraintText ?? '',
    days: cal.days.map((d) => ({ date: d, weekday: dayLabel(d).weekday })),
    // Free times that already fit the current rule, so the AI only has to apply the new
    // request. "Any time" (clear) gets the whole week. Tested live 14 Nov: with the full
    // list the model sometimes forgot the current rule.
    candidates: freeSlots(cal, parseRequest(request, cal).intent === 'clear' ? {} : (current?.constraint ?? {})).map(
      (s) => ({ id: s.id, label: slotLabel(s, cal.timezone) }),
    ),
  };
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const INTENTS: Intent[] = ['plan', 'rule', 'clear', 'unknown'];

/**
 * Turn the AI's JSON into a safe Constraint. Returns null if the answer is not
 * the shape we asked for. Unknown dates and bad times are dropped, not trusted.
 */
export function readAiAnswer(raw: unknown, cal: CalendarData): AiAnswer | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (!isStr(a.intent) || !INTENTS.includes(a.intent as Intent)) return null;
  const r = (a.rule && typeof a.rule === 'object' ? a.rule : {}) as Record<string, unknown>;
  const time = (v: unknown) => (isStr(v) && /^\d{1,2}:\d{2}$/.test(v) && hm(v) < 24 * 60 ? v : null);
  const date = (v: unknown) => (isStr(v) && cal.days.includes(v) ? v : null);
  return {
    intent: a.intent as Intent,
    rule: {
      after: time(r.after),
      before: time(r.before),
      day: date(r.day),
      notDays: Array.isArray(r.notDays) ? r.notDays.map(date).filter((d): d is string => d !== null) : [],
    },
    slotId: isStr(a.slotId) ? a.slotId : null,
    reason: isStr(a.reason) ? a.reason.trim().slice(0, MAX_REASON) : '',
    body: isStr(a.body) ? a.body.trim() : '',
  };
}

function ruleFrom(a: AiAnswer): Constraint {
  const c: Constraint = {};
  if (a.rule.after) c.after = hm(a.rule.after);
  if (a.rule.before) c.before = hm(a.rule.before);
  if (a.rule.day) c.day = a.rule.day;
  if (a.rule.notDays.length) c.notDays = a.rule.notDays;
  return c;
}

/**
 * Is this email body safe to show for this slot? It must name the right day
 * and start time and the guest, stay short, and contain no links.
 */
export function bodyMatchesSlot(body: string, slot: Slot, cal: CalendarData): boolean {
  if (!body || body.length > MAX_BODY) return false;
  if (/https?:\/\/|www\./i.test(body)) return false;
  const lower = body.toLowerCase().replace(/\s+/g, ' ');
  const day = dayLabel(slot.day);
  const dayOk = lower.includes(day.weekday.toLowerCase()) || lower.includes(day.short.toLowerCase());
  // Accept "5:30 pm", "5:30pm", "5 pm", or a range starting at the time ("5:30 – 6:00 pm").
  const start = clock(slot.start).toLowerCase(); // "5:30 pm"
  const [num, mer] = start.split(' '); // "5:30", "pm"
  const nums = num.endsWith(':00') ? [num, num.slice(0, -3)] : [num];
  const timeOk = nums.some((n) => {
    const at = String.raw`(?<![\d:])${n}`; // not part of a longer time like "14:00"
    const single = new RegExp(String.raw`${at}\s*${mer}`);
    const range = new RegExp(String.raw`${at}\s*(?:–|—|-|to)\s*\d{1,2}(?::\d{2})?\s*${mer}`);
    return single.test(lower) || range.test(lower);
  });
  // The exact 24-hour start ("17:30") is also unambiguous.
  const h24 = `${String(Math.floor(slot.start / 60)).padStart(2, '0')}:${String(slot.start % 60).padStart(2, '0')}`;
  const timeOk24 = new RegExp(String.raw`(?<![\d:])${h24}(?![\d])`).test(lower);
  return dayOk && (timeOk || timeOk24) && lower.includes(cal.guest.name.toLowerCase());
}

/** Rules-only path: chips, voice transcripts, and the fallback. */
export function planWithRules(
  cal: CalendarData,
  text: string,
  current: Plan | null,
  note = '',
): AgentResult {
  const parsed = parseRequest(text, cal);
  if (parsed.intent === 'unknown') return { plan: null, by: 'rules', note: 'Not sure what you meant.' };
  const base = parsed.intent === 'clear' ? {} : (current?.constraint ?? {});
  const constraint = parsed.intent === 'clear' ? {} : mergeConstraint(base, parsed.rule);
  const plan = makePlan(cal, constraint, ruleText(constraint), current ?? undefined, { by: 'rules', note });
  return { plan, by: 'rules', note };
}

/** Build the plan from a checked AI answer; rules fill any part that fails the checks. */
export function planFromAi(cal: CalendarData, answer: AiAnswer, current: Plan | null): AgentResult {
  if (answer.intent === 'unknown') return { plan: null, by: 'ai', note: 'Not sure what you meant.' };
  const constraint =
    answer.intent === 'clear' ? {} : mergeConstraint(current?.constraint ?? {}, ruleFrom(answer));
  const allowed = freeSlots(cal, constraint);
  const aiSlot = allowed.find((s) => s.id === answer.slotId);
  const slot = aiSlot ?? allowed[0];
  const notes: string[] = [];
  if (!aiSlot && allowed.length > 0) notes.push('AI slot did not fit the rule; rules picked the time');
  const bodyOk = slot !== undefined && aiSlot !== undefined && bodyMatchesSlot(answer.body, slot, cal);
  if (slot && !bodyOk) notes.push('rules wrote the email');
  const plan = makePlan(cal, constraint, ruleText(constraint), current ?? undefined, {
    slot,
    reason: aiSlot && answer.reason ? answer.reason : undefined,
    body: bodyOk ? answer.body : undefined,
    by: 'ai',
    note: notes.join('; '),
  });
  return { plan, by: 'ai', note: plan.note };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Ask the AI through the Worker; fall back to rules on any failure or after
 * `timeoutMs`. Never throws.
 */
export async function runAgent(
  cal: CalendarData,
  text: string,
  current: Plan | null,
  opts: { url: string; fetch?: FetchLike; timeoutMs?: number },
): Promise<AgentResult> {
  if (!opts.url) return planWithRules(cal, text, current, 'AI not set up; rules planned this');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? AI_TIMEOUT_MS);
  try {
    const res = await (opts.fetch ?? fetch)(`${opts.url.replace(/\/$/, '')}/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildPayload(cal, text, current)),
      signal: controller.signal,
    });
    if (!res.ok) return planWithRules(cal, text, current, `AI error ${res.status}; rules planned this`);
    const answer = readAiAnswer(await res.json(), cal);
    if (!answer) return planWithRules(cal, text, current, 'AI answer unreadable; rules planned this');
    return planFromAi(cal, answer, current);
  } catch (e) {
    const slow = (e as Error)?.name === 'AbortError';
    return planWithRules(cal, text, current, slow ? 'AI too slow (>3 s); rules planned this' : 'AI offline; rules planned this');
  } finally {
    clearTimeout(timer);
  }
}
