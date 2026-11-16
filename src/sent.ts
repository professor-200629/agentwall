/**
 * The start page's "Approved by you" list: every card you held in mixed reality,
 * with a real email draft, a real calendar file and a copy button.
 *
 * This is the hand-off boundary, so each item is checked again here against the
 * newest calendar the app knows (logic/review.ts): once when the list is drawn,
 * and once more at the moment a link or button is used. An item in conflict, or
 * one you replaced, stays in the list as history with nothing to use. Its
 * calendar-file link is revoked, not just hidden.
 *
 * What this cannot do: a draft already open in your mail app, or a file already
 * added to your calendar, is outside Agent Wall. The list says so.
 *
 * Plain DOM, text only (textContent, never innerHTML).
 */
import { withExample } from './logic/example-change.js';
import { asText, eventIcs, mailtoLink } from './logic/handoff.js';
import type { OutboxItem } from './logic/plan.js';
import { blockedWord, checkHandOff, revalidate, usable } from './logic/review.js';
import { restore, STORAGE_KEY } from './logic/storage.js';
import type { CalendarData } from './logic/scheduler.js';

/** Calendar-file links made for the list, by item id. Revoked on every redraw. */
const urls = new Map<string, string>();

function read(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The approved items as stored now, checked against the calendar known now. */
function current(cal: CalendarData): { items: OutboxItem[]; cal: CalendarData } {
  const saved = restore(read(), cal);
  if (!saved) return { items: [], cal };
  const view = withExample(cal, saved.example);
  return { items: revalidate(saved.outbox, view, new Date().toISOString()).outbox, cal: view };
}

function revokeAll(): void {
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls.clear();
}

const OUTSIDE = 'If you already opened its email draft or added its calendar file, remove that yourself: Agent Wall cannot reach other apps.';

/** Draw the list from what the board saved. Safe to call any time. */
export function renderSent(cal: CalendarData, real: boolean): void {
  const box = document.getElementById('sent-box');
  const list = document.getElementById('sent-list');
  if (!box || !list) return;
  revokeAll();
  list.textContent = '';
  const now = current(cal);
  const items = now.items.filter((o) => o.status !== 'sending');
  box.hidden = items.length === 0;

  /** The check at the moment of use. False: the list is redrawn and nothing is handed off. */
  const stillGood = (id: string): OutboxItem | null => {
    const fresh = current(cal);
    const check = checkHandOff(fresh.items, id, fresh.cal, new Date().toISOString());
    if (check.ok) return check.item;
    renderSent(cal, real);
    return null;
  };

  for (const item of items) {
    const li = document.createElement('li');
    const what = document.createElement('div');
    what.className = 'what';
    what.textContent = item.subject;
    const who = document.createElement('div');
    who.textContent = `To: ${item.to}${real ? '' : ' (sample)'}${item.example ? ' · EXAMPLE approval, not held by you' : ''}`;
    li.append(what, who);

    if (!usable(item)) {
      // History: shown, struck out, with nothing to open, download or copy.
      li.className = 'blocked';
      li.dataset.state = item.blocked?.why ?? 'blocked';
      const why = document.createElement('div');
      why.className = 'why';
      const word = blockedWord(item);
      const by = item.blocked?.by ? items.find((o) => o.id === item.blocked?.by) : undefined;
      why.textContent =
        item.blocked?.why === 'superseded'
          ? `${word} · you approved another time${by ? `: ${by.subject}` : ''}. Email, calendar file and copy are off.`
          : `${word} · ${item.blocked?.text ?? 'not usable'}. Email, calendar file and copy are off.`;
      const outside = document.createElement('div');
      outside.className = 'outside';
      outside.textContent = OUTSIDE;
      li.append(why, outside);
      list.append(li);
      continue;
    }

    const mail = mailtoLink(item);
    if (mail) {
      const a = document.createElement('a');
      a.href = mail;
      a.textContent = 'Open email draft';
      a.addEventListener('click', (e) => {
        if (!stillGood(item.id)) e.preventDefault();
      });
      li.append(a);
    }
    const ics = eventIcs(item);
    if (ics) {
      const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
      urls.set(item.id, url);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'agent-wall-event.ics';
      a.textContent = 'Add to my calendar (.ics)';
      a.addEventListener('click', (e) => {
        if (!stillGood(item.id)) e.preventDefault();
      });
      li.append(a);
    }
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy text';
    copy.addEventListener('click', () => {
      const good = stillGood(item.id);
      if (!good) return;
      const done = (ok: boolean) => {
        copy.textContent = ok ? 'Copied' : 'Could not copy';
        setTimeout(() => (copy.textContent = 'Copy text'), 1500);
      };
      if (!navigator.clipboard) done(false);
      else navigator.clipboard.writeText(asText(good)).then(() => done(true), () => done(false));
    });
    li.append(copy);
    list.append(li);
  }
}
