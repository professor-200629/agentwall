/**
 * When an approved plan becomes wrong.
 *
 *   new calendar snapshot ──▶ revalidate(outbox) ──▶ the item is BLOCKED at once
 *                                   │
 *                                   ▼
 *        the wall keeps the old time (labelled CONFLICT) and offers up to two
 *        other times; trying one changes nothing that was approved; a fresh
 *        pinch-and-hold approves the exact card shown; the old item is then
 *        SUPERSEDED and stays as history with nothing to hand off.
 *
 * One check for every calendar: the sample week, the labelled example change,
 * a new .ics file, a re-read link. The same check runs again on the start page
 * right before an email draft, a calendar file or the copy button is used.
 *
 * Everything here is decided by code. The AI never blocks, unblocks or approves.
 * Plain TypeScript, unit-tested.
 */
import { FOCUS_TASK, focusWindows } from './focus.js';
import { DEMO_TASK, reviewedMark, type Blocked, type ItemKind, type OutboxItem, type Plan } from './plan.js';
import { ruleText } from './request.js';
import {
  absMinutes,
  clock,
  dayLabel,
  freeSlots,
  hm,
  splitStamp,
  type BusyBlock,
  type CalendarData,
  type Constraint,
  type Slot,
} from './scheduler.js';

const short = (day: string) => dayLabel(day).short.split(' ')[0]; // "Tue"
/** "Tue 1:00 PM": the same label on the wall button, on the week and on the desk card. */
export const whenLabel = (slot: Pick<Slot, 'day' | 'start'>) => `${short(slot.day)} ${clock(slot.start)}`;

// ---------- what an approved item is ----------

/** Older records carry no kind: read it from the item itself. */
export function kindOf(item: Pick<OutboxItem, 'id' | 'subject' | 'kind'>): ItemKind {
  if (item.kind === 'call' || item.kind === 'focus' || item.kind === 'move' || item.kind === 'reminder') return item.kind;
  if (item.id.startsWith('remind-')) return 'reminder';
  if (/^Focus time: /.test(item.subject)) return 'focus';
  if (/ \(moved\): /.test(item.subject)) return 'move';
  return 'call';
}

function minutesOf(item: Pick<OutboxItem, 'minutes'>): number {
  const m = item.minutes;
  return typeof m === 'number' && Number.isInteger(m) && m >= 5 && m <= 720 ? m : 30;
}

/** The time an approved item occupies, read from the item (never from the screen). */
export function itemSlot(item: Pick<OutboxItem, 'slotId' | 'minutes'>): Slot | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(item.slotId);
  if (!m) return null;
  const start = Number(m[2]) * 60 + Number(m[3]);
  if (Number(m[2]) > 23 || Number(m[3]) > 59) return null;
  return { id: item.slotId, day: m[1], start, end: start + minutesOf(item) };
}

/** The title the item has as a calendar event ("App test call", "Focus time", "Design review"). */
function ownTitles(item: Pick<OutboxItem, 'subject'>): string[] {
  const title = (item.subject.split(': ')[0] || item.subject).trim().toLowerCase();
  return [title, title.replace(/ \(moved\)$/, '')];
}

// ---------- the check ----------

export interface Overlap {
  who: 'you' | 'guest';
  day: string;
  start: number;
  end: number;
  title: string;
}

/**
 * Busy times that overlap this slot in this calendar. A real overlap, not the
 * 10-minute gap rule: "too close" is a trade-off, not a conflict.
 * `own` is the approved item itself: once you add it to your calendar it comes
 * back in the next read at the same time under its own title, and must not
 * count against itself.
 * `solo`: a focus block or a moved meeting is on your calendar alone; the
 * guest's calendar says nothing about it.
 */
export function overlapsOf(
  cal: CalendarData,
  slot: Slot,
  own?: Pick<OutboxItem, 'id' | 'subject' | 'kind'>,
  solo: boolean = own ? ['focus', 'move'].includes(kindOf(own)) : false,
): Overlap[] {
  const a = absMinutes(slot.day, slot.start);
  const b = absMinutes(slot.day, slot.end);
  const mine = own ? ownTitles(own) : [];
  // A moved meeting may overlap its own old time: that meeting never counts against its move.
  const moved = own ? kindOf(own) === 'move' : false;
  const out: Overlap[] = [];
  const scan = (list: BusyBlock[], who: 'you' | 'guest') => {
    for (const block of list) {
      let s: { day: string; min: number };
      let e: { day: string; min: number };
      try {
        s = splitStamp(block.start);
        e = splitStamp(block.end);
      } catch {
        continue;
      }
      const from = absMinutes(s.day, s.min);
      const to = absMinutes(e.day, e.min);
      if (!(a < to && b > from)) continue;
      if (who === 'you' && (moved || (from === a && to === b)) && mine.includes(block.title.trim().toLowerCase())) continue;
      out.push({ who, day: s.day, start: s.min, end: e.min, title: block.title });
    }
  };
  scan(cal.busy.owner, 'you');
  if (!solo) scan(cal.busy.guest, 'guest');
  return out;
}

/** The reason in plain words. Titles stay on the wall's own blocks; this line never needs them. */
export function conflictText(cal: CalendarData, slot: Slot): { reason: string; detail: string } {
  return {
    reason: `${whenLabel(slot)} overlaps a new busy block`,
    // Your own calendar says nothing about the other person's.
    detail: cal.source === 'yours' ? 'Guest availability unknown' : 'Both sample calendars checked',
  };
}

const sourceOf = (cal: CalendarData): 'sample' | 'yours' => (cal.source === 'yours' ? 'yours' : 'sample');

function isPast(cal: CalendarData, slot: Slot): boolean {
  try {
    const now = splitStamp(cal.now);
    return absMinutes(slot.day, slot.end) <= absMinutes(now.day, now.min);
  } catch {
    return false;
  }
}

export interface Recheck {
  outbox: OutboxItem[];
  /** Ids that became conflicted in this check. */
  newly: string[];
  /** True when anything in the outbox changed. */
  changed: boolean;
}

/**
 * Check every approved item against the latest known calendar.
 * Running it twice on the same calendar changes nothing the second time.
 */
export function revalidate(outbox: OutboxItem[], cal: CalendarData, at: string): Recheck {
  const source = sourceOf(cal);
  // An approval that went out names the one it replaced. One still in its Unsend window does not count yet.
  const replacedBy = new Map<string, string>();
  for (const o of outbox) if (o.replaces && o.status !== 'sending') replacedBy.set(o.replaces, o.id);
  const newly: string[] = [];
  let changed = false;
  const block = (o: OutboxItem, blocked: Blocked): OutboxItem => {
    changed = true;
    return { ...o, blocked };
  };
  const clear = (o: OutboxItem): OutboxItem => {
    if (!o.blocked) return o;
    changed = true;
    const { blocked: _gone, ...rest } = o;
    return rest;
  };
  const out = outbox.map((o) => {
    if (o.status === 'sending') return o; // the board itself watches the Unsend window
    const by = replacedBy.get(o.id);
    if (o.blocked?.why === 'superseded') return o; // for good
    if (by) return block(o, { why: 'superseded', text: 'Replaced by a newer approval', at, by });
    if (o.blocked?.why === 'conflict') return o; // stays until you replace it
    if (o.reviewed !== undefined && o.reviewed !== reviewedMark(o)) {
      return o.blocked?.why === 'changed' ? o : block(o, { why: 'changed', text: 'No longer matches what you approved', at });
    }
    // Older records have no source. They were made on the calendar in use: a change of calendar cleared the board.
    const from = o.source ?? source;
    if (from !== source) {
      const text = `Approved on ${from === 'sample' ? 'the sample week' : 'your own calendar'}, not the calendar in use`;
      return o.blocked?.why === 'source' ? o : block(o, { why: 'source', text, at });
    }
    const slot = itemSlot(o);
    if (!slot || isPast(cal, slot) || overlapsOf(cal, slot, o).length === 0) return clear(o);
    newly.push(o.id);
    return block(o, { why: 'conflict', text: conflictText(cal, slot).reason, at });
  });
  return { outbox: changed ? out : outbox, newly, changed };
}

/** May this item be handed to another app (email draft, calendar file, copy)? */
export const usable = (item: Pick<OutboxItem, 'blocked' | 'status'>): boolean => !item.blocked && item.status !== 'sending';

/** A short word for a blocked item, for the outbox tray and the start page. */
export function blockedWord(item: Pick<OutboxItem, 'blocked'>): string {
  const why = item.blocked?.why;
  return why === 'superseded' ? 'REPLACED' : why === 'conflict' ? 'CONFLICT' : why ? 'BLOCKED' : '';
}

/**
 * The check at the hand-off boundary: is this item, as stored now and on the
 * calendar known now, still safe to use?
 */
export function checkHandOff(
  outbox: OutboxItem[],
  id: string,
  cal: CalendarData,
  at: string,
): { ok: true; item: OutboxItem } | { ok: false; why: string } {
  const item = revalidate(outbox, cal, at).outbox.find((o) => o.id === id);
  if (!item) return { ok: false, why: 'This approval is gone.' };
  if (item.status === 'sending') return { ok: false, why: 'Still in its Unsend window.' };
  if (item.blocked) return { ok: false, why: item.blocked.text };
  return { ok: true, item };
}

/** The newest approved call or focus block that is in conflict and not yet replaced. */
export function needsReview(outbox: OutboxItem[]): OutboxItem | null {
  for (const o of outbox) {
    if (o.blocked?.why !== 'conflict' || o.status === 'sending') continue;
    const kind = kindOf(o);
    if (kind === 'call' || kind === 'focus') return o;
  }
  return null;
}

// ---------- other times ----------

export interface Candidate {
  slot: Slot;
  /** "Wed 5:30 PM": the label the wall button, the week and the desk card all use. */
  label: string;
  /** Why this one is offered: "nearest", "same day", "same time of day", "free again". */
  why: string;
}

/** Up to two other times, found by the scheduler on this calendar, inside the rule. */
export function candidates(cal: CalendarData, kind: ItemKind, old: Slot, rule: Constraint = {}): Candidate[] {
  const pool = kind === 'focus' ? focusWindows(cal, rule, old.end - old.start) : freeSlots(cal, rule);
  if (pool.length === 0) return [];
  const at = (s: Slot) => absMinutes(s.day, s.start);
  const t0 = at(old);
  const clash = (x: Slot, y: Slot) => x.day === y.day && x.start < y.end && y.start < x.end;
  // Nearest in time; when two are equally near, the later one (never sooner than you planned for).
  const near = [...pool].sort((x, y) => Math.abs(at(x) - t0) - Math.abs(at(y) - t0) || at(y) - at(x));
  const first = near[0];
  const why = (s: Slot, fallback: string) =>
    s.id === old.id ? 'free again' : s.day === old.day ? 'same day' : s.start === old.start ? 'same time of day' : fallback;
  const out: Candidate[] = [{ slot: first, label: whenLabel(first), why: why(first, 'nearest') }];
  // A second one that is a real choice: another day, as close to the old time of day as it gets.
  const otherDay = pool
    .filter((s) => s.day !== first.day && s.id !== old.id)
    .sort((x, y) => Math.abs(x.start - old.start) - Math.abs(y.start - old.start) || Math.abs(at(x) - t0) - Math.abs(at(y) - t0));
  const second = otherDay[0] ?? near.find((s) => s.id !== first.id && !clash(s, first));
  if (second) out.push({ slot: second, label: whenLabel(second), why: why(second, 'another day') });
  return out;
}

function span(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (h) parts.push(days || m ? `${h} h` : `${h} ${h === 1 ? 'hour' : 'hours'}`);
  if (m) parts.push(days || h ? `${m} min` : `${m} minutes`);
  return parts.join(' ');
}

/** How far the replacement moves, e.g. "Moves the call 2 hours later". */
export function moveLine(kind: ItemKind, old: Slot, slot: Slot): string {
  const noun = kind === 'focus' ? 'focus block' : 'call';
  const delta = absMinutes(slot.day, slot.start) - absMinutes(old.day, old.start);
  if (delta === 0) return `Same time as before for the ${noun}`;
  return `Moves the ${noun} ${span(Math.abs(delta))} ${delta > 0 ? 'later' : 'earlier'}`;
}

/**
 * The one trade-off to read before holding: a catch at the new time when there
 * is one (a tight gap, the end of the day), otherwise how far it moves.
 */
export function replacementTradeOff(cal: CalendarData, kind: ItemKind, old: Slot, slot: Slot): string {
  if (slot.end >= hm(cal.workday.end)) return kind === 'focus' ? 'Runs to the end of the workday' : 'Last half hour of the workday';
  const parts = (list: BusyBlock[], who: 'you' | 'guest') =>
    list.flatMap((b) => {
      try {
        const s = splitStamp(b.start);
        const e = splitStamp(b.end);
        return s.day === slot.day ? [{ who, start: s.min, end: e.min }] : [];
      } catch {
        return [];
      }
    });
  const blocks = [...parts(cal.busy.owner, 'you'), ...(kind === 'focus' ? [] : parts(cal.busy.guest, 'guest'))];
  const whose = (w: 'you' | 'guest') => (w === 'you' ? 'your' : `${cal.guest.name}'s`);
  const next = blocks.filter((b) => b.start >= slot.end).sort((x, y) => x.start - y.start)[0];
  if (next && next.start - slot.end <= 30) return `Leaves ${next.start - slot.end} minutes before ${whose(next.who)} next event`;
  const prev = blocks.filter((b) => b.end <= slot.start).sort((x, y) => y.end - x.end)[0];
  if (prev && slot.start - prev.end <= 30) return `Starts ${slot.start - prev.end} minutes after ${whose(prev.who)} last event`;
  return moveLine(kind, old, slot);
}

// ---------- the plan behind an approved item ----------

/** The approved plan as the wall shows it again when the item is all that was saved. */
export function planForItem(item: OutboxItem, version: number): Plan | null {
  const slot = itemSlot(item);
  if (!slot) return null;
  const rule = item.rule ?? {};
  return {
    task: kindOf(item) === 'focus' ? FOCUS_TASK : DEMO_TASK,
    constraint: rule,
    constraintText: ruleText(rule),
    slot,
    alternatives: [],
    reason: '',
    invite: { slotId: item.slotId, to: item.to, subject: item.subject, body: item.body, source: 'rules' },
    approval: 'approved',
    version,
    by: 'rules',
    note: '',
  };
}

/** The review of one conflicted time: what the wall and the desk show while you decide. */
export interface Review {
  /** The approved item in conflict; null when it is a draft you had not approved yet. */
  itemId: string | null;
  kind: ItemKind;
  /** The old time. It stays on the wall. */
  old: Slot;
  reason: string;
  detail: string;
  /** The rule other times are looked for in (the item's own, or what you said during the review). */
  rule: Constraint;
  candidates: Candidate[];
  /** The candidate on trial, or null. A trial changes no approval. */
  trial: number | null;
  /** What the agent understood from what you said, and who understood it. */
  heard: { text: string; by: 'ai' | 'rules'; changed: boolean } | null;
}

export function startReview(cal: CalendarData, target: { item: OutboxItem } | { draft: Plan }): Review | null {
  const item = 'item' in target ? target.item : null;
  const draft = 'draft' in target ? target.draft : null;
  const old = item ? itemSlot(item) : (draft?.slot ?? null);
  if (!old) return null;
  const kind: ItemKind = item ? kindOf(item) : draft && draft.task === FOCUS_TASK ? 'focus' : 'call';
  const rule = item ? (item.rule ?? {}) : (draft?.constraint ?? {});
  const text = conflictText(cal, old);
  return {
    itemId: item?.id ?? null,
    kind,
    old,
    reason: item?.blocked?.why === 'conflict' ? item.blocked.text : text.reason,
    detail: text.detail,
    rule,
    candidates: candidates(cal, kind, old, rule),
    trial: null,
    heard: null,
  };
}

/** The calendar changed again, or you said a limit: look for other times afresh. */
export function refreshReview(cal: CalendarData, review: Review, rule: Constraint = review.rule): Review {
  const trialId = review.trial !== null ? review.candidates[review.trial]?.slot.id : undefined;
  const next = candidates(cal, review.kind, review.old, rule);
  const still = trialId ? next.findIndex((c) => c.slot.id === trialId) : -1;
  return { ...review, rule, candidates: next, trial: still >= 0 ? still : null };
}
