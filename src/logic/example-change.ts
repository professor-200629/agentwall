/**
 * "Try a calendar change": a labelled EXAMPLE of a week that changes after you approved.
 *
 *   Snapshot A  the sample week, with a call approved at a time that was free.
 *   Snapshot B  the same week with ONE new busy block on your side, over that time.
 *
 * Both are synthetic and say so: the block's title ends in "(example change)", and
 * an approval the example put there (when you had none) is marked `example`.
 * Loading B goes through the same check as reading a new calendar file
 * (review.ts `revalidate`). The example blocks are saved with the board, so the
 * conflict is still on the wall after you leave and come back.
 *
 * Plain TypeScript, unit-tested.
 */
import { approve, makePlan, type OutboxItem, type Plan } from './plan.js';
import { hm, stampOf, type BusyBlock, type CalendarData, type Slot } from './scheduler.js';

export const EXAMPLE = {
  title: 'Client call (example change)',
  mark: '(example change)',
  /** The new block lasts an hour from the approved start (cut at the end of the workday). */
  minutes: 60,
  /**
   * How many example blocks stay on the week. Older ones leave it when a new one is added:
   * with six, the sixth change left no free time at all, and no way out inside the headset.
   */
  maxBlocks: 3,
};

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** The new busy block of snapshot B, over this approved time. */
export function exampleBlock(cal: CalendarData, slot: Pick<Slot, 'day' | 'start' | 'end'>): BusyBlock {
  const end = Math.max(slot.end, Math.min(slot.start + EXAMPLE.minutes, hm(cal.workday.end)));
  return { start: stampOf(slot.day, slot.start), end: stampOf(slot.day, end), title: EXAMPLE.title };
}

export const isExampleBlock = (b: Pick<BusyBlock, 'title'>): boolean => b.title.endsWith(EXAMPLE.mark);

/** Example blocks as read back from storage: well-formed, few, and always labelled. */
export function cleanExample(raw: unknown): BusyBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: BusyBlock[] = [];
  for (const b of raw) {
    if (!b || typeof b !== 'object') continue;
    const { start, end } = b as Record<string, unknown>;
    if (typeof start !== 'string' || typeof end !== 'string' || !STAMP.test(start) || !STAMP.test(end) || start >= end) continue;
    if (out.some((o) => o.start === start && o.end === end)) continue;
    out.push({ start, end, title: EXAMPLE.title });
  }
  // The newest ones are kept: they are the ones behind the conflict on the wall now.
  return out.slice(-EXAMPLE.maxBlocks);
}

/** The week with the example blocks on your side. Your own calendar never gets them. */
export function withExample(cal: CalendarData, blocks: BusyBlock[]): CalendarData {
  if (blocks.length === 0 || cal.source === 'yours') return cal;
  return { ...cal, busy: { owner: [...cal.busy.owner, ...blocks], guest: cal.busy.guest } };
}

/**
 * Snapshot A's approval, for a board that has none yet: the first free time of
 * the sample week, approved by the example and labelled as such.
 */
export function exampleApproval(cal: CalendarData, approvedAt: string, startUtc?: string | null): { plan: Plan; item: OutboxItem } | null {
  const done = approve(makePlan(cal), approvedAt, { source: 'sample', example: true, startUtc });
  if (!done) return null;
  const item: OutboxItem = {
    ...done.item,
    status: 'sent',
    receipt: [
      { tag: 'DEMO', text: 'EXAMPLE approval, put here by “Try a calendar change”.' },
      { tag: 'DEMO', text: 'You did not hold this one. Nothing was sent.' },
    ],
  };
  return { plan: done.plan, item };
}
