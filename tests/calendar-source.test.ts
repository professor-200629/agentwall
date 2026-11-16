import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import calendarJson from '../src/data/sample-calendar.json';
import {
  activeCalendar,
  CALENDAR_KEY,
  checkLink,
  guestFrom,
  importLink,
  importText,
  parseSaved,
  savedCalendar,
  setDetails,
  shortLine,
  useSample,
} from '../src/calendar-source.js';
import { draftInvite, makePlan } from '../src/logic/plan.js';
import { buildPayload } from '../src/logic/agent.js';
import { buildRealCalendar } from '../src/logic/real-week.js';
import type { CalendarData } from '../src/logic/scheduler.js';
import worker from '../worker/src/index.js';
import { icsUrlAllowed } from '../worker/src/lib.js';

const sample = calendarJson as CalendarData;
const NOW = new Date(2026, 10, 17, 8, 0); // Tuesday 8 AM, machine time
const pad = (n: number) => String(n).padStart(2, '0');
/** A UTC stamp for a machine-local time, so the test passes in any time zone. */
const utc = (y: number, mo: number, d: number, h: number, mi = 0) => {
  const t = new Date(y, mo - 1, d, h, mi);
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}00Z`;
};
const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:a',
  `DTSTART:${utc(2026, 11, 17, 10)}`,
  `DTEND:${utc(2026, 11, 17, 11)}`,
  'SUMMARY:Secret merger talks with Northwind',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:b',
  `DTSTART:${utc(2026, 11, 25, 14)}`,
  `DTEND:${utc(2026, 11, 25, 15)}`,
  'SUMMARY:Next week',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');
const GOOGLE = 'https://calendar.google.com/calendar/ical/someone%40example.com/private-abc123/basic.ics';

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('calendar links: only known calendar hosts, only https', () => {
  it('accepts Google, Outlook and iCloud; webcal:// becomes https://', () => {
    expect(checkLink(GOOGLE)).toEqual({ ok: true, url: GOOGLE });
    expect(checkLink('webcal://p12-caldav.icloud.com/published/2/abc').ok).toBe(true);
    expect(checkLink('https://outlook.office365.com/owa/calendar/x/y/calendar.ics').ok).toBe(true);
  });

  it('refuses everything else, with a plain reason', () => {
    expect(checkLink('hello')).toEqual({ ok: false, error: 'That is not a link.' });
    expect(checkLink('http://calendar.google.com/x.ics').ok).toBe(false);
    expect(checkLink('https://evil.example/calendar.google.com/x.ics').ok).toBe(false);
    expect(checkLink('https://calendar.google.com.evil.example/x.ics').ok).toBe(false);
    expect(checkLink('https://notcalendar.google.com.evil/x').ok).toBe(false);
  });

  it('the Worker checks the same way, and also refuses credentials and odd ports', () => {
    expect(icsUrlAllowed(GOOGLE)?.hostname).toBe('calendar.google.com');
    expect(icsUrlAllowed('https://user:pw@calendar.google.com/x.ics')).toBeNull();
    expect(icsUrlAllowed('https://calendar.google.com:8443/x.ics')).toBeNull();
    expect(icsUrlAllowed('https://169.254.169.254/latest/meta-data')).toBeNull();
    expect(icsUrlAllowed('https://localhost/x.ics')).toBeNull();
    expect(icsUrlAllowed('http://calendar.google.com/x.ics')).toBeNull();
    expect(icsUrlAllowed({ url: GOOGLE })).toBeNull();
  });
});

describe('your calendar in this browser', () => {
  it('with nothing saved the wall shows the sample week and says so', () => {
    const a = activeCalendar(NOW);
    expect(a.real).toBe(false);
    expect(a.cal).toEqual(sample);
    expect(a.label).toBe('SAMPLE WEEK · not a real calendar');
  });

  it('a file import keeps busy blocks only, for the next two working weeks', () => {
    const r = importText(ICS, 'file', { now: NOW });
    expect(r).toEqual({ ok: true, busy: 2 });
    const saved = savedCalendar();
    expect(saved?.source).toBe('file');
    expect(saved?.url).toBeUndefined();
    // The calendar text itself is not kept.
    expect(localStorage.getItem(CALENDAR_KEY)).not.toMatch(/VCALENDAR|UID/);
    const a = activeCalendar(NOW);
    expect(a.real).toBe(true);
    expect(a.cal.days[0]).toBe('2026-11-17');
    expect(a.cal.busy.owner).toEqual([{ start: '2026-11-17T10:00', end: '2026-11-17T11:00', title: 'Secret merger talks with No…' }]);
    expect(a.label).toMatch(/^YOUR CALENDAR · read .+ · sample guest$/);
  });

  it('what is not a calendar is refused and nothing is saved', () => {
    expect(importText('<html>Sign in to Google</html>', 'file', { now: NOW }).ok).toBe(false);
    expect(savedCalendar()).toBeNull();
  });

  it('event titles never go to the AI: it gets free times and the guest\'s name', () => {
    importText(ICS, 'file', { now: NOW, details: { guest: guestFrom('Priya', 'priya@example.com'), owner: 'Balu', topic: 'the Q3 budget' } });
    const cal = activeCalendar(NOW).cal;
    const payload = JSON.stringify(buildPayload(cal, 'Find a time for my app tester call and draft the invite', null));
    expect(payload).not.toMatch(/merger|Northwind|Secret/i);
    expect(payload).toMatch(/Priya/);
  });

  it('your own topic, guest and name go into the invite', () => {
    importText(ICS, 'file', { now: NOW, details: { guest: guestFrom('Priya', 'priya@example.com'), owner: 'Balu', topic: 'the Q3 budget' } });
    const cal = activeCalendar(NOW).cal;
    const plan = makePlan(cal);
    expect(plan.invite?.to).toBe('Priya <priya@example.com>');
    expect(plan.invite?.subject).toMatch(/^Call about the Q3 budget: Tue 17 Nov, /);
    expect(plan.invite?.body).toMatch(/to talk about the Q3 budget\?/);
    expect(plan.invite?.body).toMatch(/Thanks,\nBalu$/);
    expect(plan.invite?.body).not.toMatch(/app test/);
  });

  it('with no topic and no email the invite says less, never something untrue', () => {
    const cal = buildRealCalendar(sample, { blocks: [], guest: guestFrom('Priya', 'not an email') }, NOW);
    const inv = draftInvite(cal, makePlan(cal).slot!);
    expect(inv.to).toBe('Priya');
    expect(inv.subject).toMatch(/^Call: /);
    expect(inv.body).not.toMatch(/app test|talk about/);
  });

  it('the sample week\'s invite is unchanged', () => {
    expect(makePlan(sample).invite?.subject).toMatch(/^App test call: /);
    expect(makePlan(sample).invite?.body).toMatch(/to go through your app test notes\?/);
  });

  it('details can change later; back to sample removes everything', () => {
    importText(ICS, 'file', { now: NOW });
    expect(setDetails({ guest: guestFrom('Arun', ''), owner: 'Balu', topic: 'launch' })).toBe(true);
    expect(savedCalendar()).toMatchObject({ guest: { name: 'Arun', email: '' }, owner: 'Balu', topic: 'launch' });
    useSample();
    expect(savedCalendar()).toBeNull();
    expect(setDetails({ guest: null, owner: '', topic: '' })).toBe(false);
  });

  it('stored data is never trusted', () => {
    expect(parseSaved('not json')).toBeNull();
    expect(parseSaved('{"v":2}')).toBeNull();
    expect(parseSaved(JSON.stringify({ v: 1, source: 'link', url: 'https://evil.example/x.ics', savedAt: 'x', blocks: [] }))).toBeNull();
    const cleaned = parseSaved(
      JSON.stringify({
        v: 1,
        source: 'file',
        savedAt: '2026-11-17T02:30:00.000Z',
        blocks: [
          { start: '2026-11-17T10:00', end: '2026-11-17T11:00', title: 'A\nB' },
          { start: 'bad', end: 'bad', title: 'x' },
          { start: '2026-11-17T12:00', end: '2026-11-17T11:00', title: 'backwards' },
        ],
        guest: { name: '<b>Priya</b>\n', email: 'x' },
        owner: 'Balu<script>',
        topic: 42,
      }),
    );
    expect(cleaned?.blocks).toEqual([{ start: '2026-11-17T10:00', end: '2026-11-17T11:00', title: 'A B' }]);
    expect(cleaned?.guest).toEqual({ name: '<b>Priya</b>', email: '', role: 'guest' });
    expect(cleaned?.owner).toBe('Balu script');
    expect(cleaned?.topic).toBe('42');
    expect(shortLine('  a\tb  ')).toBe('a b');
  });
});

describe('reading a link through the Worker', () => {
  const SITE = 'https://professor-200629.github.io';
  const env = { GROQ_API_KEY: '' };
  const post = (body: unknown, origin = SITE) =>
    new Request('https://agentwall.example.workers.dev/ics', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('the app asks the Worker for exactly the link, then keeps the blocks and the link', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(ICS, { status: 200 });
    }) as unknown as typeof fetch;
    const r = await importLink(GOOGLE, 'https://w.example/', { fetch: fake });
    expect(r.ok).toBe(true);
    expect(calls).toEqual([{ url: 'https://w.example/ics', body: JSON.stringify({ url: GOOGLE }) }]);
    expect(savedCalendar()).toMatchObject({ source: 'link', url: GOOGLE });
  });

  it('a bad link never reaches the network; failures are plain words', async () => {
    const fake = vi.fn() as unknown as typeof fetch;
    expect(await importLink('https://evil.example/a.ics', 'https://w.example', { fetch: fake })).toMatchObject({ ok: false });
    expect(fake).not.toHaveBeenCalled();
    expect(await importLink(GOOGLE, '', { fetch: fake })).toMatchObject({ ok: false });
    const down = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await importLink(GOOGLE, 'https://w.example', { fetch: down })).toEqual({
      ok: false,
      error: 'The calendar could not be reached. Check the connection and try again.',
    });
    const gone = (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch;
    expect(await importLink(GOOGLE, 'https://w.example', { fetch: gone })).toEqual({
      ok: false,
      error: 'The calendar link was not found. Copy it again.',
    });
    expect(savedCalendar()).toBeNull();
  });

  it('Worker: fetches an allowed link and returns the calendar text (no AI key needed)', async () => {
    const upstream = vi.fn(async () => new Response(ICS, { status: 200, headers: { 'content-type': 'text/calendar' } }));
    vi.stubGlobal('fetch', upstream);
    const res = await worker.fetch(post({ url: GOOGLE }), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(ICS);
    expect(res.headers.get('access-control-allow-origin')).toBe(SITE);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(String(upstream.mock.calls[0][0])).toBe(GOOGLE);
  });

  it('Worker: is not an open proxy', async () => {
    const upstream = vi.fn(async () => new Response('secret', { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    for (const url of ['https://example.com/x.ics', 'http://calendar.google.com/x', 'https://169.254.169.254/', 'file:///etc/passwd', 42]) {
      expect((await worker.fetch(post({ url }), env)).status).toBe(400);
    }
    expect((await worker.fetch(post({ url: GOOGLE }, 'https://evil.example'), env)).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('Worker: a redirect off the calendar host is refused; a page that is not a calendar is refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } })));
    expect((await worker.fetch(post({ url: GOOGLE }), env)).status).toBe(400);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Sign in</html>', { status: 200 })));
    expect((await worker.fetch(post({ url: GOOGLE }), env)).status).toBe(400);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 404 })));
    expect((await worker.fetch(post({ url: GOOGLE }), env)).status).toBe(404);
  });
});
