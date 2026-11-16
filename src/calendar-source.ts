/**
 * Which calendar the wall shows: the SAMPLE week (the default, and what judges
 * see with no setup), or YOUR calendar, read from an .ics file or a private
 * iCal link on the start page.
 *
 * What is kept: only the busy blocks (time + a short title) of the next two
 * working weeks, in this browser's localStorage. The calendar text itself is
 * not kept. A link is kept so the calendar can be read again on the next visit.
 * Nothing here is sent to the AI: the agent gets free times, never titles.
 */
import calendarJson from './data/sample-calendar.json';
import { busyFromIcs, cleanTitle, ICS_LIMITS } from './logic/ics.js';
import { buildRealCalendar, workWeek } from './logic/real-week.js';
import type { BusyBlock, CalendarData, Person } from './logic/scheduler.js';

export const CALENDAR_KEY = 'agentwall.calendar.v1';
/** Working days read ahead, so the wall still has data a few days after an import. */
const DAYS_AHEAD = 10;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** Calendar hosts a link may point at. The Worker checks the same list again. */
export const ICS_HOSTS = ['calendar.google.com', 'outlook.office365.com', 'outlook.live.com', 'icloud.com'];

export interface SavedCalendar {
  v: 1;
  source: 'file' | 'link';
  /** The private link, when the source is a link. */
  url?: string;
  /** ISO time of the last successful read. */
  savedAt: string;
  blocks: BusyBlock[];
  guest: Person | null;
  /** Your first name, for signing the email. Empty = "Me". */
  owner: string;
  /** What the call is about. Empty = no topic in the email. */
  topic: string;
}

/** What the start page's boxes say. */
export interface Details {
  guest: Person | null;
  owner: string;
  topic: string;
}

/** A short single line typed on the start page (a name or a topic). */
export function shortLine(raw: unknown, max = 40): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export interface ActiveCalendar {
  cal: CalendarData;
  real: boolean;
  /** One line for the board and the start page. */
  label: string;
}

const sample = calendarJson as CalendarData;

function read(): string | null {
  try {
    return localStorage.getItem(CALENDAR_KEY);
  } catch {
    return null;
  }
}

function write(json: string | null): boolean {
  try {
    if (json === null) localStorage.removeItem(CALENDAR_KEY);
    else localStorage.setItem(CALENDAR_KEY, json);
    return true;
  } catch {
    return false;
  }
}

/** A calendar link as an https URL on a known calendar host, or the reason it is refused. */
export function checkLink(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const text = raw.trim().replace(/^webcal:\/\//i, 'https://');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: 'That is not a link.' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'The link must start with https://' };
  const host = url.hostname.toLowerCase();
  if (!ICS_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return { ok: false, error: 'Only Google, Outlook and iCloud calendar links are read.' };
  }
  return { ok: true, url: url.toString() };
}

/** A guest from the start page's two boxes; null when no usable name was given. */
export function guestFrom(name: string, email: string): Person | null {
  const n = cleanTitle(name);
  const e = email.trim().slice(0, 120);
  if (!name.trim()) return null;
  return { name: n, email: /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e) ? e : '', role: 'guest' };
}

/** Parse what was stored. Anything malformed is dropped: storage is never trusted. */
export function parseSaved(json: string | null): SavedCalendar | null {
  if (!json) return null;
  try {
    const d = JSON.parse(json) as Record<string, unknown>;
    if (d.v !== 1 || (d.source !== 'file' && d.source !== 'link') || typeof d.savedAt !== 'string') return null;
    if (!Array.isArray(d.blocks)) return null;
    const blocks = d.blocks
      .filter(
        (b): b is BusyBlock =>
          !!b && typeof b === 'object' && STAMP.test(String(b.start)) && STAMP.test(String(b.end)) && String(b.start) < String(b.end),
      )
      .slice(0, ICS_LIMITS.maxBlocks)
      .map((b) => ({ start: b.start, end: b.end, title: cleanTitle(b.title) }));
    let url: string | undefined;
    if (d.source === 'link') {
      const link = typeof d.url === 'string' ? checkLink(d.url) : null;
      if (!link?.ok) return null;
      url = link.url;
    }
    const g = d.guest as Record<string, unknown> | null | undefined;
    const guest = g && typeof g.name === 'string' ? guestFrom(g.name, typeof g.email === 'string' ? g.email : '') : null;
    return { v: 1, source: d.source, url, savedAt: d.savedAt, blocks, guest, owner: shortLine(d.owner, 24), topic: shortLine(d.topic) };
  } catch {
    return null;
  }
}

export const savedCalendar = (): SavedCalendar | null => parseSaved(read());

function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** What the last re-read of a linked calendar did. A failed one changes nothing that was known. */
export type RefreshResult = { tried: false } | { tried: true; ok: true; busy: number } | { tried: true; ok: false; error: string };
let lastRefresh: RefreshResult = { tried: false };
export const refreshState = (): RefreshResult => lastRefresh;

/** The calendar to plan on right now. */
export function activeCalendar(now: Date = new Date()): ActiveCalendar {
  const saved = savedCalendar();
  if (!saved) return { cal: sample, real: false, label: 'SAMPLE WEEK · not a real calendar' };
  const cal = buildRealCalendar(sample, { blocks: saved.blocks, guest: saved.guest, owner: saved.owner, topic: saved.topic }, now);
  const who = saved.guest ? '' : ' · sample guest';
  // A failed re-read is said out loud: the wall still shows the last calendar that was read.
  const stale = lastRefresh.tried && !lastRefresh.ok ? ' · REFRESH FAILED, showing that read' : '';
  return { cal, real: true, label: `YOUR CALENDAR · read ${whenLabel(saved.savedAt)}${stale}${who}` };
}

export type ImportResult = { ok: true; busy: number } | { ok: false; error: string };

/** Read calendar text and keep its busy blocks. */
export function importText(
  text: string,
  source: 'file' | 'link',
  opts: { url?: string; details?: Details; now?: Date } = {},
): ImportResult {
  const now = opts.now ?? new Date();
  const result = busyFromIcs(text, workWeek(now, DAYS_AHEAD));
  if (!result.ok) return result;
  const saved: SavedCalendar = {
    v: 1,
    source,
    url: source === 'link' ? opts.url : undefined,
    savedAt: now.toISOString(),
    blocks: result.blocks,
    guest: opts.details?.guest ?? null,
    owner: shortLine(opts.details?.owner, 24),
    topic: shortLine(opts.details?.topic),
  };
  if (!write(JSON.stringify(saved))) return { ok: false, error: 'This browser would not save it (storage is blocked).' };
  return { ok: true, busy: result.blocks.length };
}

/**
 * Read a private iCal link. Calendar hosts do not allow a web page to read them
 * directly, so the text comes through Agent Wall's Worker, which fetches that
 * one link and hands the text back without keeping it.
 */
export async function importLink(
  rawUrl: string,
  workerUrl: string,
  opts: { details?: Details; timeoutMs?: number; fetch?: typeof fetch } = {},
): Promise<ImportResult> {
  const link = checkLink(rawUrl);
  if (!link.ok) return link;
  if (!workerUrl) return { ok: false, error: 'Links need the Agent Wall server, which this build does not have. Use an .ics file.' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await (opts.fetch ?? fetch)(`${workerUrl.replace(/\/$/, '')}/ics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: link.url }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return { ok: false, error: res.status === 404 ? 'The calendar link was not found. Copy it again.' : `The calendar could not be read (${res.status}).` };
    }
    return importText(await res.text(), 'link', { url: link.url, details: opts.details });
  } catch {
    return { ok: false, error: 'The calendar could not be reached. Check the connection and try again.' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A linked calendar is read again (on start, and when you pinch "Refresh my calendar").
 * On success the new snapshot replaces the old one; on failure the old one is kept
 * and the result says so. Never throws.
 */
export async function refreshLinked(
  workerUrl: string,
  timeoutMs = 4000,
  fetchImpl?: typeof fetch,
): Promise<RefreshResult> {
  const saved = savedCalendar();
  if (!saved || saved.source !== 'link' || !saved.url) return (lastRefresh = { tried: false });
  const r = await importLink(saved.url, workerUrl, { details: saved, timeoutMs, fetch: fetchImpl });
  lastRefresh = r.ok ? { tried: true, ok: true, busy: r.busy } : { tried: true, ok: false, error: r.error };
  return lastRefresh;
}

/** Change who the call is with and what it is about, keeping the calendar. */
export function setDetails(details: Details): boolean {
  const saved = savedCalendar();
  if (!saved) return false;
  return write(JSON.stringify({ ...saved, guest: details.guest, owner: shortLine(details.owner, 24), topic: shortLine(details.topic) }));
}

/** Back to the sample week: your blocks and link are removed from this browser. */
export function useSample(): void {
  write(null);
}
