import { describe, expect, it } from 'vitest';
import ICAL from 'ical.js';
import calendarJson from '../src/data/sample-calendar.json';
import { asText, eventIcs, eventMinutes, isEvent, mailtoLink, recipient } from '../src/logic/handoff.js';
import { makeFocusPlan } from '../src/logic/focus.js';
import { reminderItem } from '../src/logic/next-step.js';
import { approve, makePlan, type OutboxItem } from '../src/logic/plan.js';
import { restore, serialize } from '../src/logic/storage.js';
import type { CalendarData } from '../src/logic/scheduler.js';

const cal = calendarJson as CalendarData;
const AT = '2026-11-16T04:00:00.000Z';
const invite = approve(makePlan(cal), AT)!.item;
const focus = approve(makeFocusPlan(cal), AT)!.item;

describe('what you approved, as a real email draft and calendar file', () => {
  it('reads the recipient; refuses what has no address', () => {
    expect(recipient('Sam <sam.tester@example.com>')).toEqual({ name: 'Sam', email: 'sam.tester@example.com' });
    expect(recipient('priya@example.com')).toEqual({ name: '', email: 'priya@example.com' });
    expect(recipient('Priya')).toBeNull();
    expect(recipient('Your calendar (Balu, sample)')).toBeNull();
    expect(recipient('Sam <not-an-address>')).toBeNull();
  });

  it('the email draft carries the exact words you approved', () => {
    const link = mailtoLink(invite)!;
    expect(link.startsWith('mailto:sam.tester@example.com?subject=')).toBe(true);
    const url = new URL(link);
    expect(url.searchParams.get('subject')).toBe(invite.subject);
    expect(url.searchParams.get('body')).toBe(invite.body.replace(/\n/g, '\r\n'));
  });

  it('text in a subject cannot add recipients or headers', () => {
    const link = mailtoLink({ to: 'Sam <sam@example.com>', subject: 'Hi&bcc=evil@example.com', body: 'x\nBcc: evil@example.com' })!;
    const url = new URL(link);
    expect([...url.searchParams.keys()]).toEqual(['subject', 'body']);
    expect(url.pathname).toBe('sam@example.com');
  });

  it('a focus block has no one to email, but is a calendar event', () => {
    expect(mailtoLink(focus)).toBeNull();
    expect(eventIcs(focus)).toMatch(/SUMMARY:Focus time/);
  });

  it('the calendar file is valid and holds the approved time and length', () => {
    const ics = eventIcs(invite)!;
    const event = new ICAL.Event(new ICAL.Component(ICAL.parse(ics)).getFirstSubcomponent('vevent')!);
    expect(event.summary).toBe('App test call');
    expect(event.startDate.toString()).toBe('2026-11-17T13:00:00');
    expect(event.endDate.toString()).toBe('2026-11-17T13:30:00');
    expect(event.description).toBe(invite.body);
    expect(ics).toMatch(/ATTENDEE;CN=Sam:mailto:sam\.tester@example\.com/);
    // Floating time: the same wall clock on whatever device opens it.
    expect(ics).toMatch(/DTSTART:20261117T130000\r\n/);
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });

  it('two hours of focus time is two hours in the file', () => {
    const event = new ICAL.Event(new ICAL.Component(ICAL.parse(eventIcs(focus)!)).getFirstSubcomponent('vevent')!);
    expect(event.duration.toSeconds()).toBe(7200);
  });

  it('a reminder is a message, not an event', () => {
    const r = reminderItem(cal, makePlan(cal).slot!, AT);
    expect(isEvent(r)).toBe(false);
    expect(eventIcs(r)).toBeNull();
    expect(mailtoLink(r)).toMatch(/^mailto:sam\.tester@example\.com\?/);
  });

  it('a stored length is checked, and a broken time gives no file', () => {
    expect(eventMinutes({ minutes: 120 })).toBe(120);
    expect(eventMinutes({ minutes: -5 })).toBe(30);
    expect(eventMinutes({ minutes: '90' })).toBe(30);
    expect(eventMinutes({})).toBe(30);
    expect(eventIcs({ ...invite, slotId: 'tomorrow' })).toBeNull();
    expect(eventIcs({ ...invite, slotId: '2026-13-40T99:99' })).toBeNull();
  });

  it('special characters in the words are escaped, not turned into fields', () => {
    const item: OutboxItem = { ...invite, subject: 'Plan; budget, Q3: Tue', body: 'Line 1\nEND:VEVENT\nBEGIN:VEVENT; x, y \\ z' };
    const comp = new ICAL.Component(ICAL.parse(eventIcs(item)!));
    expect(comp.getAllSubcomponents('vevent')).toHaveLength(1);
    const event = new ICAL.Event(comp.getFirstSubcomponent('vevent')!);
    expect(event.description).toBe(item.body);
    expect(event.summary).toBe('Plan; budget, Q3');
  });

  it('the length survives saving and reopening', () => {
    const back = restore(serialize(null, [{ ...focus, status: 'sent' }], AT), cal);
    expect(back?.outbox[0].minutes).toBe(120);
  });

  it('copy text is the whole message', () => {
    expect(asText(invite)).toBe(`To: ${invite.to}\nSubject: ${invite.subject}\n\n${invite.body}`);
  });
});
